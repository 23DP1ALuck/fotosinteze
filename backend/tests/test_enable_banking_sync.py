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
        self.assertEqual(kwargs['params']['transaction_status'], 'BOOK')
        return copy.deepcopy(self.pages[kwargs['params'].get('continuation_key')])

    async def sync(self):
        return await service.sync(self.workspace, self.db)

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
