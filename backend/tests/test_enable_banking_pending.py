import json
from unittest.mock import patch
from sqlalchemy import select
from app.models import Account,EnableBankingConnection,Transaction
from app.services import enable_banking_service as authorization
from tests.bank_test_case import BankTestCase


class PendingBankTests(BankTestCase):
    async def test_encrypted_snapshot_is_scoped_read_only_and_excluded_from_ledger(self):
        self.db.add(EnableBankingConnection(workspace_id=1,connected_by_id=1))
        await self.db.flush()
        row=await self.db.scalar(select(EnableBankingConnection))
        account=Account(workspace_id=1,name='Bank',currency='EUR',balance=100,banking_connection_id=row.connection_id)
        self.db.add(account)
        await self.db.flush()
        item={'account_id':account.account_id,'amount':'12.30','currency':'EUR','description':'Pending purchase','direction':'expense','date':None}
        row.pending_transactions_encrypted=authorization.encryption_cipher().encrypt(json.dumps([item]).encode()).decode()
        await self.db.commit()
        self.db.expunge_all()
        response=await self.client.get('/enable-banking/pending',headers={'Workspace-ID':'1'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['items'],[item])
        self.assertEqual((await self.db.scalars(select(Transaction))).all(),[])
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual((await self.client.get('/enable-banking/pending',headers={'Workspace-ID':'2'})).status_code,400)
        self.assertEqual((await self.client.get('/enable-banking/pending',headers={'Workspace-ID':'999'})).status_code,403)
        row=await self.db.scalar(select(EnableBankingConnection))
        item['account_id']=999
        row.pending_transactions_encrypted=authorization.encryption_cipher().encrypt(json.dumps([item]).encode()).decode()
        await self.db.commit()
        self.assertEqual((await self.client.get('/enable-banking/pending',headers={'Workspace-ID':'1'})).status_code,409)

    async def test_empty_or_deleting_connection_returns_empty_snapshot(self):
        self.assertEqual((await self.client.get('/enable-banking/pending',headers={'Workspace-ID':'1'})).json(),{'items':[]})
        self.db.add(EnableBankingConnection(workspace_id=1,connected_by_id=1,pending_status='deleting',pending_transactions_encrypted='corrupted'))
        await self.db.commit()
        self.assertEqual((await self.client.get('/enable-banking/pending',headers={'Workspace-ID':'1'})).json(),{'items':[]})
