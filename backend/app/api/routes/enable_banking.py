import json
import secrets
from html import escape

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, Query
from fastapi.responses import HTMLResponse
from pydantic import HttpUrl

from app.database import AsyncSession, get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.models import Workspace
from app.services import enable_banking_refresh, enable_banking_pending, enable_banking_delete
from app.models import EnableBankingConnection
from sqlalchemy import select
from app.services import enable_banking_service as service

router = APIRouter(tags=['enable-banking'])
COOKIE = 'enable_banking_browser'


@router.get('/enable-banking/connection')
async def connection_status(request: Request, response: Response, workspace: Workspace = Depends(get_current_workspace),
                            db: AsyncSession = Depends(get_db_session)):
    response.headers['Cache-Control'] = 'no-store'
    status = await service.connection_status(workspace, db)
    connection = await db.scalar(select(EnableBankingConnection).where(
        EnableBankingConnection.workspace_id == workspace.workspace_id))
    headers = enable_banking_refresh.psu_headers(request)
    interval = service.settings.enable_banking_auto_sync_interval_seconds
    return {**status.model_dump(), 'auto_sync_interval_seconds': max(5, interval) if interval and headers else None,
            'next_sync_at': enable_banking_refresh.next_sync_at(connection, headers) if connection else None}


@router.post('/enable-banking/sync')
async def import_accounts(request: Request, response: Response, recent: bool = Query(False),
                          automatic: bool = Query(False), workspace: Workspace = Depends(get_current_workspace),
                          db: AsyncSession = Depends(get_db_session)):
    response.headers['Cache-Control'] = 'no-store'
    return await enable_banking_refresh.refresh(workspace, db, request=request, recent=recent, automatic=automatic)


@router.get('/enable-banking/pending')
async def pending_transactions(response: Response, workspace: Workspace = Depends(get_current_workspace),
                               db: AsyncSession = Depends(get_db_session)):
    response.headers['Cache-Control'] = 'no-store'
    return await enable_banking_pending.pending(workspace, db)


@router.delete('/enable-banking/connection', status_code=204)
async def delete_connection(response: Response, workspace: Workspace = Depends(get_current_workspace),
                            db: AsyncSession = Depends(get_db_session)):
    await enable_banking_delete.disconnect(workspace, db)
    response.delete_cookie(COOKIE, path='/enable-banking/callback', secure=True, httponly=True, samesite='none')
    response.headers['Cache-Control'] = 'no-store'


@router.post('/enable-banking/authorize')
async def authorize(response: Response, current_user: dict = Depends(get_current_user),
                    workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db_session)):
    url, browser = await service.start_authorization(current_user, workspace, db)
    response.set_cookie(COOKIE, browser, max_age=600, path='/enable-banking/callback',
                        secure=True, httponly=True, samesite='none')
    response.headers['Cache-Control'] = 'no-store'
    return {'authorization_url': url}


@router.get('/enable-banking/callback', response_class=HTMLResponse)
async def callback_page(request: Request):
    # The provider uses query parameters; suppress them in the application access log.
    request.scope['query_string'] = b''
    nonce = secrets.token_urlsafe(16)
    # Strip provider query parameters before posting the one-use code.
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>Bank authorization</title>
<p role="status" id="result">Completing Bank authorization…</p>
<p><a href="APP_URL" rel="noreferrer">Return to Fotosinteze</a></p><script nonce="NONCE">
(async () => {
  const params = new URLSearchParams(location.search.slice(1));
  history.replaceState(null, '', location.pathname);
  const result = document.getElementById('result');
  try {
    const response = await fetch('/enable-banking/callback', {
      method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({state: params.get('state'), code: params.get('code'), error: params.get('error')})
    });
    result.textContent = response.ok ? 'Bank authorization completed. Return to Fotosinteze to view your connection.'
      : 'Bank authorization failed or expired. Return to the app and try again.';
  } catch { result.textContent = 'Could not complete authorization. Return to the app and try again.'; }
})();
</script></html>'''.replace('NONCE', nonce).replace('APP_URL', escape(str(HttpUrl(service.settings.client_url)).rstrip('/') + '/app', quote=True))
    return HTMLResponse(html, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': f"default-src 'none'; script-src 'nonce-{nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"})


@router.post('/enable-banking/callback')
async def callback(request: Request, response: Response,
                   enable_banking_browser: str | None = Cookie(None), db: AsyncSession = Depends(get_db_session)):
    # Parse explicitly so FastAPI validation responses cannot echo a malformed authorization code.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 16384:
            raise HTTPException(400, 'Invalid Bank callback', headers={'Cache-Control': 'no-store'})
    try:
        data = service.CallbackInput.model_validate(json.loads(body))
    except ValueError:
        raise HTTPException(400, 'Invalid Bank callback', headers={'Cache-Control': 'no-store'}) from None
    try:
        result = await service.finish_authorization(data, enable_banking_browser, db)
    except HTTPException as exc:
        exc.headers = {'Cache-Control': 'no-store'}
        raise
    response.delete_cookie(COOKIE, path='/enable-banking/callback', secure=True, httponly=True, samesite='none')
    response.headers['Cache-Control'] = 'no-store'
    return result
