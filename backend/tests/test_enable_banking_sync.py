import copy
import hashlib
import json
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import Account, Category, EnableBankingConnection, Transaction, User, Workspace
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum
from app.services import enable_banking_sync as service

UID = '3a57e2d3-2e0c-4336-af9b-7fa94f0606a3'


def transaction(reference='stable-1', **changes):
    return {'entry_reference': reference, 'transaction_id': 'unstable-id', 'status': 'BOOK',
            'transaction_amount': {'amount': '12.34', 'currency': 'EUR'},
            'credit_debit_indicator': 'DBIT', 'booking_date': '2026-10-20',
            'remittance_information': ['Shop', 'Purchase'], **changes}


class EnableBankingSyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.workspace = Workspace(workspace_id=1, name='Personal', type=WorkspaceTypeEnum.PERSONAL)
        self.db.add_all([self.workspace, User(user_id=1, email='test@example.test', display_name='Test', password='unused'),
                         Workspace(workspace_id=2, name='Other', type=WorkspaceTypeEnum.PERSONAL)])
        await self.db.flush()
        self.cipher = Fernet(Fernet.generate_key())
        expires = datetime.now(timezone.utc) + timedelta(hours=1)
        self.session = {'session_id': UID, 'accounts': [{'uid': UID, 'identification_hash': 'stable-hash',
                        'currency': 'EUR', 'name': 'My Revolut'}], 'access': {'valid_until': expires.isoformat()}}
        self.connection = EnableBankingConnection(workspace_id=1, connected_by_id=1,
            session_encrypted=self.encrypt_session(), expires_at=expires.replace(tzinfo=None))
        self.db.add(self.connection)
        await self.db.commit()
        self.balance = '-50.25'
        self.pages = {None: {'transactions': [transaction(), transaction('stable-2', credit_debit_indicator='CRDT'),
                                              {'status': 'PDNG'}]}}
        self.cipher_patch = patch.object(service.authorization, 'encryption_cipher', return_value=self.cipher)
        self.cipher_patch.start()
        self.provider_patch = patch.object(service.client, 'request', side_effect=self.provider)
        self.outbound = self.provider_patch.start()

    async def asyncTearDown(self):
        self.provider_patch.stop()
        self.cipher_patch.stop()
        await self.db.close()
        await self.engine.dispose()

    def encrypt_session(self):
        return self.cipher.encrypt(json.dumps(self.session).encode()).decode()

    async def provider(self, method, path, **kwargs):
        self.assertEqual(method, 'GET')
        if path.endswith('/balances'):
            return {'balances': [{'balance_type': 'CLBD', 'balance_amount': {'amount': '999', 'currency': 'EUR'}},
                                 {'balance_type': 'ITAV', 'balance_amount': {'amount': self.balance, 'currency': 'EUR'}}]}
        if kwargs['params']['transaction_status'] == 'PDNG':
            return {'transactions': []}
        self.assertEqual(kwargs['params']['transaction_status'], 'BOOK')
        return copy.deepcopy(self.pages[kwargs['params'].get('continuation_key')])

    async def sync(self):
        return await service.sync(self.workspace, self.db)

    async def test_mcc_reuses_shared_categories_without_duplicates(self):
        names = {'5411': 'Groceries', '5812': 'Restaurants', '4111': 'Transportation',
                 '7011': 'Travel', '5912': 'Health', '5311': 'Shopping',
                 '7832': 'Entertainment', '4900': 'Utilities', '6300': 'Insurance',
                 '8398': 'Donations', '7230': 'Services', '6011': 'Cash'}
        for name in names.values():
            self.db.add(Category(workspace_id=None, name=name, type=CategoryType.expense))
        self.db.add(Category(workspace_id=1, name='Groceries', type=CategoryType.expense))
        await self.db.commit()
        self.pages = {None: {'transactions': [transaction(code, merchant_category_code=code) for code in names]}}
        self.assertEqual((await self.sync())['imported_count'], len(names))
        rows = (await self.db.execute(select(Transaction, Category).join(Category))).all()
        self.assertEqual(len(rows), len(names))
        for tx, category in rows:
            self.assertEqual(category.name, names[tx.external_transaction_id])
            self.assertIsNone(category.workspace_id)
        self.assertEqual((await self.sync())['imported_count'], 0)
        self.assertEqual(len((await self.db.scalars(select(Category))).all()), len(names) + 1)

    async def test_missing_mapped_category_is_created_once_in_current_workspace(self):
        self.db.add_all([Category(workspace_id=2, name='Restaurants', type=CategoryType.expense),
                         Category(workspace_id=None, name='Restaurants', type=CategoryType.income)])
        await self.db.commit()
        self.pages = {None: {'transactions': [transaction('a', merchant_category_code='5812'),
                                              transaction('b', merchant_category_code='5814')]}}
        await self.sync()
        await self.sync()
        categories = list((await self.db.scalars(select(Category).where(Category.workspace_id == 1))).all())
        self.assertEqual([(c.name, c.type) for c in categories], [('Restaurants', CategoryType.expense)])
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()), 2)

    async def test_mcc_upgrades_fallback_only_and_preserves_transaction_ids_and_user_choices(self):
        await self.sync()
        original = list((await self.db.scalars(select(Transaction).order_by(Transaction.transaction_id))).all())
        ids = [tx.transaction_id for tx in original]
        shared = Category(workspace_id=None, name='Groceries', type=CategoryType.expense)
        chosen = Category(workspace_id=1, name='User choice', type=CategoryType.expense)
        self.db.add_all([shared, chosen])
        await self.db.commit()
        self.pages[None]['transactions'][0]['merchant_category_code'] = '5411'
        # MCC describes the merchant, not whether a credit is salary, cashback or a refund.
        self.pages[None]['transactions'][1]['merchant_category_code'] = '5411'
        self.assertEqual((await self.sync())['imported_count'], 0)
        self.assertEqual(original[0].category_id, shared.category_id)
        credit_category = await self.db.get(Category, original[1].category_id)
        self.assertEqual(credit_category.type, CategoryType.income)
        original[0].category_id = chosen.category_id
        await self.db.commit()
        await self.sync()
        self.assertEqual(original[0].category_id, chosen.category_id)
        self.assertEqual([tx.transaction_id for tx in (await self.db.scalars(
            select(Transaction).order_by(Transaction.transaction_id))).all()], ids)

    async def test_unusable_mcc_keeps_direction_fallback_without_inventing_categories(self):
        values = [None, '9999', '', '54x1', '５４１１', 5411, {'code': '5411'}]
        self.pages = {None: {'transactions': [transaction(str(i), merchant_category_code=value)
                                              for i, value in enumerate(values)]}}
        self.assertEqual((await self.sync())['imported_count'], len(values))
        categories = list((await self.db.scalars(select(Category))).all())
        self.assertEqual([c.name for c in categories], ['Bank expense'])

    async def test_existing_workspace_category_is_reused_when_shared_category_is_absent(self):
        category = Category(workspace_id=1, name='Groceries', type=CategoryType.expense)
        self.db.add(category)
        await self.db.commit()
        self.pages = {None: {'transactions': [transaction(merchant_category_code='5411')]}}
        await self.sync()
        self.assertEqual((await self.db.scalar(select(Transaction))).category_id, category.category_id)
        self.assertEqual(len((await self.db.scalars(select(Category))).all()), 1)

    async def test_invalid_later_page_does_not_reclassify_existing_transactions(self):
        await self.sync()
        original = await self.db.scalar(select(Transaction).where(Transaction.external_transaction_id == 'stable-1'))
        category_id = original.category_id
        self.pages[None]['transactions'][0]['merchant_category_code'] = '5411'
        self.pages[None]['continuation_key'] = 'bad-page'
        self.pages['bad-page'] = {'transactions': [transaction('bad', booking_date='invalid')]}
        with self.assertRaises(HTTPException):
            await self.sync()
        await self.db.refresh(original)
        self.assertEqual(original.category_id, category_id)
        self.assertIsNone(await self.db.scalar(select(Category).where(Category.name == 'Groceries')))

    async def test_idempotent_import_preserves_categories_names_and_provider_balance(self):
        self.db.add(Category(workspace_id=2, name='Bank expense', type=CategoryType.expense))
        await self.db.commit()
        result = await self.sync()
        self.assertEqual((result['accounts_count'], result['imported_count']), (1, 2))
        self.assertEqual(result['last_sync_at'].tzinfo, timezone.utc)
        account = await self.db.scalar(select(Account))
        self.assertEqual(account.balance, Decimal('-50.25'))
        self.assertTrue(account.is_main)
        self.assertEqual(account.external_account_id, hashlib.sha256(b'stable-hash|EUR').hexdigest())
        txs = list((await self.db.scalars(select(Transaction).order_by(Transaction.transaction_id))).all())
        self.assertEqual([tx.amount for tx in txs], [Decimal('12.34')] * 2)
        self.assertEqual([tx.source for tx in txs], [TransactionSourceEnum.BANK] * 2)
        self.assertEqual(txs[0].created_at, datetime(2026, 10, 20))
        self.assertEqual(txs[0].description, 'Shop Purchase')
        categories = {c.category_id: c for c in (await self.db.scalars(select(Category))).all()}
        self.assertEqual(categories[txs[0].category_id].type, CategoryType.expense)
        self.assertEqual(categories[txs[1].category_id].type, CategoryType.income)
        self.assertEqual(categories[txs[0].category_id].workspace_id, 1)
        custom = Category(workspace_id=1, name='Groceries', type=CategoryType.expense)
        self.db.add(custom)
        await self.db.flush()
        txs[0].category_id = custom.category_id
        account.name = 'User name'
        await self.db.commit()
        self.balance = '5.00'
        self.pages[None]['transactions'][0]['transaction_id'] = 'changed-unstable-id'
        result = await self.sync()
        await self.db.refresh(account)
        await self.db.refresh(txs[0])
        self.assertEqual(result['imported_count'], 0)
        self.assertEqual(account.name, 'User name')
        self.assertEqual(account.balance, Decimal('5.00'))
        self.assertEqual(txs[0].category_id, custom.category_id)
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()), 2)

    async def test_reconnect_uid_change_uses_existing_account(self):
        await self.sync()
        account = await self.db.scalar(select(Account))
        original = account.account_id
        self.session['accounts'][0]['uid'] = '4a57e2d3-2e0c-4336-af9b-7fa94f0606a3'
        self.session['session_id'] = self.session['accounts'][0]['uid']
        self.connection.session_encrypted = self.encrypt_session()
        await self.db.commit()
        self.assertEqual((await self.sync())['imported_count'], 0)
        self.assertEqual([a.account_id for a in (await self.db.scalars(select(Account))).all()], [original])

    async def test_zero_booked_amounts_are_skipped_and_zero_balance_is_allowed(self):
        self.balance = '0.00'
        self.pages[None]['transactions'].extend([
            transaction('zero-debit', transaction_amount={'amount': '0.00', 'currency': 'EUR'}),
            transaction('zero-credit', credit_debit_indicator='CRDT',
                        transaction_amount={'amount': '0', 'currency': 'EUR'}),
        ])
        result = await self.sync()
        self.assertEqual(result['imported_count'], 2)
        self.assertEqual((await self.db.scalar(select(Account))).balance, Decimal('0.00'))
        transactions = list((await self.db.scalars(select(Transaction))).all())
        self.assertEqual({tx.external_transaction_id for tx in transactions}, {'stable-1', 'stable-2'})
        self.assertTrue(all(tx.amount > 0 for tx in transactions))
        self.assertEqual((await self.sync())['imported_count'], 0)

    async def test_empty_pages_are_followed_and_repeated_keys_fail_atomically(self):
        self.pages = {None: {'transactions': [], 'continuation_key': 'page2'},
                      'page2': {'transactions': [transaction()], 'continuation_key': 'page3'},
                      'page3': {'transactions': []}}
        self.assertEqual((await self.sync())['imported_count'], 1)
        self.pages['page3']['continuation_key'] = 'page2'
        self.balance = '100.00'
        with self.assertRaises(HTTPException) as error:
            await self.sync()
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual((await self.db.scalar(select(Account))).balance, Decimal('-50.25'))
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()), 1)

    async def test_malformed_later_page_does_not_write_anything(self):
        defects = [{'entry_reference': None}, {'entry_reference': ''},
                   {'transaction_amount': {'amount': '1.234', 'currency': 'EUR'}},
                   {'transaction_amount': {'amount': 'NaN', 'currency': 'EUR'}},
                   {'transaction_amount': {'amount': '1', 'currency': 'USD'}},
                   {'booking_date': None}, {'credit_debit_indicator': 'INVALID'},
                   {'remittance_information': 'sensitive-provider-text'}]
        for defect in defects:
            self.pages = {None: {'transactions': [transaction()], 'continuation_key': 'next'},
                          'next': {'transactions': [transaction('stable-2', **defect)]}}
            with self.subTest(defect=defect), self.assertRaises(HTTPException) as error:
                await self.sync()
            self.assertEqual(error.exception.status_code, 502)
            self.assertNotIn('sensitive-provider-text', str(error.exception))
            self.assertEqual((await self.db.scalars(select(Account))).all(), [])
            self.assertEqual((await self.db.scalars(select(Transaction))).all(), [])
            await self.db.refresh(self.connection)
            self.assertIsNone(self.connection.last_sync_at)

    async def test_reconnect_during_fetch_rejects_stale_result(self):
        provider = self.provider
        async def reconnect(method, path, **kwargs):
            result = await provider(method, path, **kwargs)
            self.connection.session_encrypted = self.encrypt_session()
            await self.db.commit()
            return result
        self.outbound.side_effect = reconnect
        with self.assertRaises(HTTPException) as error:
            await self.sync()
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual((await self.db.scalars(select(Account))).all(), [])

    async def test_bad_session_expiry_and_workspace_never_call_provider(self):
        original = self.connection.session_encrypted
        for invalid in ['bad-ciphertext', self.cipher.encrypt(b'{}').decode()]:
            self.connection.session_encrypted = invalid
            await self.db.commit()
            with self.assertRaises(HTTPException) as error:
                await self.sync()
            self.assertEqual(error.exception.status_code, 409)
        self.connection.session_encrypted = original
        self.connection.expires_at = datetime(2000, 1, 1)
        await self.db.commit()
        with self.assertRaises(HTTPException) as error:
            await self.sync()
        self.assertEqual(error.exception.status_code, 409)
        self.workspace.type = WorkspaceTypeEnum.BUSINESS
        with self.assertRaises(HTTPException) as error:
            await self.sync()
        self.assertEqual(error.exception.status_code, 400)
        self.outbound.assert_not_awaited()

    async def test_invalid_balances_and_conflicting_references_are_atomic(self):
        original = self.provider
        for defect in ['precision', 'range', 'missing', 'duplicate', 'conflicting_reference']:
            async def malformed(method, path, **kwargs):
                result = await original(method, path, **kwargs)
                if path.endswith('/balances'):
                    balances = result['balances']
                    if defect == 'precision': balances[-1]['balance_amount']['amount'] = '1.234'
                    if defect == 'range': balances[-1]['balance_amount']['amount'] = '100000000.00'
                    if defect == 'missing': result['balances'] = []
                    if defect == 'duplicate': balances.append(copy.deepcopy(balances[-1]))
                elif defect == 'conflicting_reference':
                    result['transactions'].append(transaction(credit_debit_indicator='CRDT'))
                return result
            self.outbound.side_effect = malformed
            with self.subTest(defect=defect), self.assertRaises(HTTPException) as error:
                await self.sync()
            self.assertEqual(error.exception.status_code, 502)
            self.assertEqual((await self.db.scalars(select(Account))).all(), [])
            self.assertEqual((await self.db.scalars(select(Category))).all(), [])

    async def test_session_structure_and_duplicates_are_revalidated_before_network(self):
        original = copy.deepcopy(self.session)
        for defect in ['uid', 'hash', 'currency', 'duplicate', 'expired_access']:
            self.session = copy.deepcopy(original)
            if defect == 'uid': self.session['accounts'][0]['uid'] = 'invalid-path'
            if defect == 'hash': self.session['accounts'][0]['identification_hash'] = ''
            if defect == 'currency': self.session['accounts'][0]['currency'] = 'eur'
            if defect == 'duplicate': self.session['accounts'].append(self.session['accounts'][0])
            if defect == 'expired_access': self.session['access']['valid_until'] = '2000-01-01T00:00:00Z'
            self.connection.session_encrypted = self.encrypt_session()
            await self.db.commit()
            with self.subTest(defect=defect), self.assertRaises(HTTPException) as error:
                await self.sync()
            self.assertEqual(error.exception.status_code, 409)
        self.outbound.assert_not_awaited()

    async def test_page_limit_and_malformed_page_cannot_publish_partial_data(self):
        original = self.provider
        count = 0
        async def endless(method, path, **kwargs):
            nonlocal count
            if path.endswith('/balances'):
                return await original(method, path, **kwargs)
            count += 1
            return {'transactions': [transaction()], 'continuation_key': str(count)}
        self.outbound.side_effect = endless
        with self.assertRaises(HTTPException) as error:
            await self.sync()
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(count, 1000)
        self.assertEqual((await self.db.scalars(select(Account))).all(), [])
        for page in [{'transactions': {}}, {'transactions': [], 'continuation_key': 23},
                     {'transactions': [transaction(status='UNKNOWN')]}]:
            self.pages = {None: page}
            self.outbound.side_effect = original
            with self.assertRaises(HTTPException) as error:
                await self.sync()
            self.assertEqual(error.exception.status_code, 502)
            self.assertEqual((await self.db.scalars(select(Account))).all(), [])

    async def use_pending(self, items):
        self.pending_pages = {None: {'transactions': items}}
        original = self.provider
        async def provider(method, path, **kwargs):
            if kwargs.get('params', {}).get('transaction_status') == 'PDNG':
                return copy.deepcopy(self.pending_pages[kwargs['params'].get('continuation_key')])
            return await original(method, path, **kwargs)
        self.outbound.side_effect = provider

    async def snapshot(self):
        await self.db.refresh(self.connection)
        return json.loads(self.cipher.decrypt(self.connection.pending_transactions_encrypted.encode()))

    async def test_recent_pending_without_identifiers_or_dates_stays_outside_ledger(self):
        pending = transaction(status='PDNG')
        for key in ('entry_reference', 'transaction_id', 'booking_date'):
            pending.pop(key)
        await self.use_pending([pending, pending])
        await service.sync(self.workspace, self.db, recent=True)
        snapshot = await self.snapshot()
        self.assertEqual(len(snapshot), 2)
        account = await self.db.scalar(select(Account))
        self.assertEqual(snapshot[0], {'account_id': account.account_id, 'amount': '12.34',
            'currency': 'EUR', 'description': 'Shop Purchase', 'direction': 'expense', 'date': None})
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()), 2)

    async def test_pending_pagination_deduplication_and_transition_to_booked(self):
        await self.use_pending([])
        pending = transaction('pending-1', status='PDNG', transaction_date='2026-10-21')
        self.pending_pages = {None: {'transactions': [pending], 'continuation_key': 'next'},
                              'next': {'transactions': [pending, transaction(status='PDNG')]}}
        await service.sync(self.workspace, self.db, recent=True)
        self.assertEqual(len(await self.snapshot()), 1)
        self.assertEqual((await self.snapshot())[0]['date'], '2026-10-21')
        self.pages[None]['transactions'].append(transaction('pending-1'))
        await service.sync(self.workspace, self.db, recent=True)
        self.assertEqual(await self.snapshot(), [])
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()), 3)

    async def test_pending_failure_preserves_snapshot_balance_and_booked_ledger(self):
        await self.use_pending([transaction('pending-1', status='PDNG')])
        await service.sync(self.workspace, self.db, recent=True)
        before = await self.snapshot()
        self.balance = '500'
        self.pages[None]['transactions'].append(transaction('new-booked'))
        self.pending_pages = {None: {'transactions': [], 'continuation_key': 'next'},
            'next': {'transactions': [transaction('bad', status='PDNG',
                transaction_amount={'amount': '-1', 'currency': 'EUR'})]}}
        with self.assertRaises(HTTPException) as error:
            await service.sync(self.workspace, self.db, recent=True)
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(await self.snapshot(), before)
        self.assertEqual((await self.db.scalar(select(Account))).balance, Decimal('-50.25'))
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()), 2)

    async def test_recent_window_and_psu_headers_forward_to_all_account_reads(self):
        await self.use_pending([])
        await service.sync(self.workspace, self.db, recent=True)
        for call in self.outbound.await_args_list:
            self.assertNotIn('headers', call.kwargs)
            self.assertNotIn('date_from', call.kwargs.get('params', {}))
        self.connection.last_sync_at = datetime(2026, 10, 20, 23, 59)
        await self.db.commit()
        self.outbound.reset_mock()
        headers = {'PSU-IP-Address': '192.0.2.5'}
        await service.sync(self.workspace, self.db, recent=True, psu_headers=headers)
        for call in self.outbound.await_args_list:
            self.assertEqual(call.kwargs['headers'], headers)
            if call.kwargs.get('params', {}).get('transaction_status') == 'BOOK':
                self.assertEqual(call.kwargs['params']['date_from'], '2026-10-13')
        self.outbound.reset_mock()
        await self.sync()
        self.assertTrue(all('date_from' not in call.kwargs.get('params', {})
                            for call in self.outbound.await_args_list))

    async def test_deletion_started_during_fetch_rejects_stale_results(self):
        original = self.provider
        async def deleting(method, path, **kwargs):
            response = await original(method, path, **kwargs)
            self.connection.pending_status = 'deleting'
            await self.db.commit()
            return response
        self.outbound.side_effect = deleting
        with self.assertRaises(HTTPException) as error:
            await self.sync()
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual((await self.db.scalars(select(Account))).all(), [])

    async def test_invalid_pending_data_and_repeated_pages_keep_previous_snapshot(self):
        await self.use_pending([transaction('pending-1', status='PDNG')])
        await service.sync(self.workspace, self.db, recent=True)
        before = await self.snapshot()
        defects = [
            {'transaction_amount': {'amount': '0', 'currency': 'EUR'}},
            {'transaction_amount': {'amount': 'NaN', 'currency': 'EUR'}},
            {'transaction_amount': {'amount': '1', 'currency': 'USD'}},
            {'transaction_amount': {'amount': '1.234', 'currency': 'EUR'}},
            {'credit_debit_indicator': 'UNKNOWN'}, {'transaction_date': '2026-10-22T12:00:00Z'},
            {'booking_date': 'not-a-date'}, {'remittance_information': ['x' * 4097]},
            {'remittance_information': 'not-a-list'}, {'status': 'UNKNOWN'},
        ]
        for defect in defects:
            self.pending_pages = {None: {'transactions': [transaction('pending-2', **{'status': 'PDNG', **defect})]}}
            with self.subTest(defect=defect), self.assertRaises(HTTPException) as error:
                await service.sync(self.workspace, self.db, recent=True)
            self.assertEqual(error.exception.status_code, 502)
            self.assertEqual(await self.snapshot(), before)
        self.pending_pages = {None: {'transactions': [], 'continuation_key': 'loop'},
                              'loop': {'transactions': [], 'continuation_key': 'loop'}}
        with self.assertRaises(HTTPException) as error:
            await service.sync(self.workspace, self.db, recent=True)
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(await self.snapshot(), before)

    async def test_pending_provider_failure_keeps_previous_snapshot(self):
        await self.use_pending([transaction('pending-1', status='PDNG')])
        await service.sync(self.workspace, self.db, recent=True)
        before = await self.snapshot()
        original = self.outbound.side_effect
        async def unavailable(method, path, **kwargs):
            if kwargs.get('params', {}).get('transaction_status') == 'PDNG':
                raise HTTPException(429, 'Bank temporarily rate limited')
            return await original(method, path, **kwargs)
        self.outbound.side_effect = unavailable
        self.pages[None]['transactions'].append(transaction('unpublished'))
        with self.assertRaises(HTTPException) as error:
            await service.sync(self.workspace, self.db, recent=True)
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(await self.snapshot(), before)
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()), 2)

    async def test_deleting_connection_never_calls_provider(self):
        self.connection.pending_status = 'deleting'
        await self.db.commit()
        with self.assertRaises(HTTPException) as error:
            await self.sync()
        self.assertEqual(error.exception.status_code, 409)
        self.outbound.assert_not_awaited()

    async def test_new_refresh_claim_during_fetch_rejects_old_claim(self):
        self.connection.sync_started_at = datetime(2026, 10, 20)
        await self.db.commit()
        original = self.provider
        async def newer_claim(method, path, **kwargs):
            response = await original(method, path, **kwargs)
            self.connection.sync_started_at = datetime(2026, 10, 21)
            await self.db.commit()
            return response
        self.outbound.side_effect = newer_claim
        with self.assertRaises(HTTPException) as error:
            await service.sync(self.workspace, self.db, claim_started_at=datetime(2026, 10, 20))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual((await self.db.scalars(select(Account))).all(), [])


    async def test_full_sync_replaces_pending_snapshot_when_purchase_becomes_booked(self):
        await self.use_pending([transaction('pending-to-book', status='PDNG')])
        await service.sync(self.workspace, self.db, recent=True)
        self.assertEqual(len(await self.snapshot()), 1)
        self.pages[None]['transactions'].append(transaction('pending-to-book'))
        await self.sync()
        self.assertEqual(await self.snapshot(), [])
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()), 3)
