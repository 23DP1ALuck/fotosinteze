"""Shared request attribution and database-backed bank refresh quota."""
import ipaddress
import math
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from fastapi import HTTPException, Request
from sqlalchemy import or_, select, update

from app.models import EnableBankingConnection as Connection
from app.services import enable_banking_service as authorization, enable_banking_sync as sync_service


def psu_headers(request: Request) -> dict | None:
    try:
        peer = ipaddress.ip_address(request.client.host)
        trusted = any(peer in ipaddress.ip_network(cidr.strip()) for cidr in
                      authorization.settings.enable_banking_trusted_proxy_cidrs.split(',') if cidr.strip())
        address = ipaddress.ip_address(request.headers.get('cf-connecting-ip', '')) if trusted else peer
        user_agent = request.headers.get('user-agent', '')
        if not address.is_global or not user_agent or len(user_agent) > 4096 or any(c in user_agent for c in '\r\n'):
            return None
    except (ValueError, AttributeError):
        return None
    return {'Psu-Ip-Address': str(address), 'Psu-User-Agent': user_agent}


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def next_sync_at(connection, headers) -> datetime | None:
    cooldown = max(30, authorization.settings.enable_banking_auto_sync_interval_seconds or 0) if headers else 21600
    deadlines = [aware(connection.sync_retry_at), aware(connection.sync_lease_until)]
    if connection.sync_started_at is not None:
        deadlines.append(aware(connection.sync_started_at) + timedelta(seconds=cooldown))
    return max((value for value in deadlines if value is not None), default=None)


def throttled(deadline, now):
    seconds = max(1, math.ceil((deadline - now).total_seconds()))
    return HTTPException(429, 'Bank refresh is temporarily limited; try again later',
                         headers={'Retry-After': str(seconds)})


def provider_retry(exc, now, headers):
    delay = 60
    value = (exc.headers or {}).get('Retry-After', '')
    try:
        delay = float(value)
        if not math.isfinite(delay):
            delay = 60
    except (TypeError, ValueError):
        try:
            delay = (aware(parsedate_to_datetime(value)) - now).total_seconds()
        except (TypeError, ValueError, OverflowError):
            pass
    delay = max(60 if headers else 21600, min(86400, delay))
    return now + timedelta(seconds=delay)


async def refresh(workspace, db, *, request: Request, recent=False, automatic=False):
    authorization.personal(workspace)
    headers = psu_headers(request)
    if automatic and (authorization.settings.enable_banking_auto_sync_interval_seconds is None or not headers):
        raise HTTPException(503, 'Automatic bank refresh requires configuration and an active user request')
    workspace_id = workspace.workspace_id
    connection = await db.scalar(select(Connection).where(Connection.workspace_id == workspace_id))
    now = datetime.now(timezone.utc)
    if (connection is None or connection.pending_status == 'deleting' or not connection.session_encrypted
            or connection.expires_at is None or aware(connection.expires_at) <= now):
        raise HTTPException(409, 'Reconnect the bank before syncing')
    deadline = next_sync_at(connection, headers)
    if deadline is not None and deadline > now:
        raise throttled(deadline, now)
    connection_id, encrypted = connection.connection_id, connection.session_encrypted
    started = now.replace(tzinfo=None)
    claimed = await db.execute(update(Connection).where(
        Connection.connection_id == connection_id,
        Connection.workspace_id == workspace_id,
        Connection.session_encrypted == encrypted,
        Connection.sync_started_at == connection.sync_started_at,
        Connection.sync_retry_at == connection.sync_retry_at,
        Connection.sync_lease_until == connection.sync_lease_until,
        Connection.expires_at > started,
        or_(Connection.pending_status.is_(None), Connection.pending_status != 'deleting'),
    ).values(sync_started_at=started, sync_lease_until=started + timedelta(minutes=5)))
    if claimed.rowcount != 1:
        await db.rollback()
        raise HTTPException(409, 'Bank connection changed; reload and try again')
    await db.commit()
    retry = None
    succeeded = False
    try:
        result = await sync_service.sync(workspace, db, psu_headers=headers, recent=recent,
                                       automatic=automatic, claim_started_at=started)
        succeeded = True
        return result
    except HTTPException as exc:
        if exc.status_code == 429:
            retry = provider_retry(exc, datetime.now(timezone.utc), headers)
            raise throttled(retry, datetime.now(timezone.utc)) from None
        raise
    finally:
        if not succeeded:
            await db.rollback()
        await db.execute(update(Connection).where(
            Connection.connection_id == connection_id,
            Connection.workspace_id == workspace_id,
            Connection.session_encrypted == encrypted,
            Connection.sync_started_at == started,
            or_(Connection.pending_status.is_(None), Connection.pending_status != 'deleting'),
        ).values(sync_lease_until=None, sync_retry_at=retry.replace(tzinfo=None) if retry else None))
        await db.commit()
