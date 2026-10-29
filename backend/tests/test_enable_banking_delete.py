import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi import HTTPException
from sqlalchemy import select
from app.models import Account, Category, EnableBankingConnection, Transaction, Workspace
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.services import enable_banking_delete as service
from app.services import enable_banking_service as authorization
from tests.bank_test_case import BankTestCase

UID = '497f6eca-6276-4993-bfeb-53cbbbba6f08'


class EnableBankingDeleteTests(BankTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.config.enable_banking_redirect_uri="https://backend.test/enable-banking/callback"
        self.row = EnableBankingConnection(workspace_id=1, connected_by_id=1, pending_status='authorized',
            expires_at=datetime.now(timezone.utc).replace(tzinfo=None)+timedelta(days=1),
            state_hash='old-state', session_encrypted=authorization.encryption_cipher().encrypt(json.dumps({'session_id':UID}).encode()).decode())
        self.db.add(self.row)
        await self.db.flush()
        self.bank = Account(workspace_id=1, name='Bank', currency='EUR', balance=100, is_main=True, banking_connection_id=self.row.connection_id)
        self.manual = Account(workspace_id=1, name='Cash', currency='EUR', balance=20)
        self.category = Category(workspace_id=1, name='Food', type=CategoryType.expense)
        self.db.add_all([self.bank,self.manual,self.category])
        await self.db.flush()
        for source in (TransactionSourceEnum.BANK, TransactionSourceEnum.MANUAL):
            self.db.add(Transaction(workspace_id=1,account_id=self.bank.account_id,category_id=self.category.category_id,
                amount=5,currency='EUR',description='Related',source=source))
        self.db.add(Transaction(workspace_id=1,account_id=self.manual.account_id,category_id=self.category.category_id,
            amount=2,currency='EUR',description='Unrelated',source=TransactionSourceEnum.MANUAL))
        await self.db.commit()
        self.provider_patch=patch.object(service.client,'request',return_value={})
        self.provider=self.provider_patch.start()
        self.addCleanup(self.provider_patch.stop)

    async def remove(self, wid='1'):
        return await self.client.delete('/enable-banking/connection',headers={'Workspace-ID':wid})

    async def test_revokes_session_and_purges_only_linked_data(self):
        response=await self.remove()
        self.assertEqual(response.status_code,204,response.text)
        self.provider.assert_awaited_once_with('DELETE','/sessions/'+UID)
        self.assertEqual([a.account_id for a in (await self.db.scalars(select(Account))).all()],[self.manual.account_id])
        self.assertEqual([t.description for t in (await self.db.scalars(select(Transaction))).all()],['Unrelated'])
        self.assertIsNotNone(await self.db.get(Category,self.category.category_id))
        self.assertIsNone(await self.db.scalar(select(EnableBankingConnection)))
        self.assertEqual((await self.remove()).status_code,204)
        self.assertEqual((await self.client.get('/enable-banking/connection',headers={'Workspace-ID':'1'})).json()['status'],'not_connected')

    async def test_failed_provider_revoke_keeps_data_and_blocks_old_callback(self):
        self.provider.side_effect=HTTPException(502,'Provider unavailable')
        response=await self.remove()
        self.assertEqual(response.status_code,502,response.text)
        await self.db.refresh(self.row)
        self.assertEqual(self.row.pending_status,'deleting')
        self.assertIsNone(self.row.state_hash)
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()),3)
        self.provider.side_effect=None
        self.assertEqual((await self.remove()).status_code,204)

    async def test_access_is_personal_scoped_and_authorized(self):
        self.assertEqual((await self.remove('2')).status_code,400)
        self.assertEqual((await self.remove('999')).status_code,403)
        self.provider.assert_not_awaited()
        self.assertEqual(len((await self.db.scalars(select(Transaction))).all()),3)

    async def test_pending_consent_without_session_can_be_deleted(self):
        self.row.session_encrypted=None
        self.row.pending_status='pending'
        await self.db.commit()
        self.assertEqual((await self.remove()).status_code,204)
        self.provider.assert_not_awaited()

    async def test_reconnect_cannot_replace_a_deleting_connection(self):
        self.row.pending_status='deleting'
        await self.db.commit()
        response=await self.client.post('/enable-banking/authorize',headers={'Workspace-ID':'1'})
        self.assertEqual(response.status_code,409,response.text)

    async def test_callback_finishing_during_deletion_revokes_new_orphan_session(self):
        from app.services.enable_banking_service import CallbackInput
        fresh='597f6eca-6276-4993-bfeb-53cbbbba6f08'
        self.row.state_hash=authorization.digest('pending-state')
        self.row.browser_hash=authorization.digest('browser')
        self.row.pending_status='pending'
        self.row.pending_user_id=1
        self.row.pending_expires_at=datetime.now(timezone.utc).replace(tzinfo=None)+timedelta(minutes=5)
        await self.db.commit()
        async def provider(method,path,**kwargs):
            if method=='POST':
                await service.disconnect(await self.db.get(Workspace,1),self.db)
                return {'session_id':fresh,'aspsp':{'name':'Revolut','country':'LV'},'psu_type':'personal',
                    'access':{'valid_until':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()},
                    'accounts':[{'uid':fresh,'identification_hash':'hash','currency':'EUR'}]}
            return {}
        self.provider.side_effect=provider
        with self.assertRaises(HTTPException):
            await authorization.finish_authorization(CallbackInput(state='pending-state',code='one-use-code'),'browser',self.db)
        revoked=[call.args[1] for call in self.provider.await_args_list if call.args[0]=='DELETE']
        self.assertEqual(revoked,['/sessions/'+UID,'/sessions/'+fresh])
        self.assertIsNone(await self.db.scalar(select(EnableBankingConnection)))
