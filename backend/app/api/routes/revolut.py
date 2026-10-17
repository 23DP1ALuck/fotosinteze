import json
import secrets

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse

from app.database import AsyncSession, get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.models import Workspace
from app.services import revolut_authorization_service as service

router = APIRouter(tags=['revolut'])
COOKIE = 'revolut_browser'


@router.post('/revolut/authorize')
async def authorize(response: Response, current_user: dict = Depends(get_current_user),
                    workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db_session)):
    url, browser = await service.start_authorization(current_user, workspace, db)
    response.set_cookie(COOKIE, browser, max_age=600, path='/revolut/callback',
                        secure=True, httponly=True, samesite='none')
    response.headers['Cache-Control'] = 'no-store'
    return {'authorization_url': url}


@router.get('/.well-known/jwks.json')
async def jwks():
    return service.public_jwks()


@router.get('/revolut/callback', response_class=HTMLResponse)
async def callback_page():
    nonce = secrets.token_urlsafe(16)
    # Fragments stay in the browser; strip them before posting the code to avoid URL/access-log leaks.
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>Revolut authorization</title>
<p role="status" id="result">Completing Revolut authorization…</p><script nonce="NONCE">
(async () => {
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  const result = document.getElementById('result');
  try {
    const response = await fetch('/revolut/callback', {
      method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({state: params.get('state'), code: params.get('code'), error: params.get('error')})
    });
    result.textContent = response.ok ? 'Revolut authorization completed. You can close this window.'
      : 'Revolut authorization failed or expired. Return to the app and try again.';
  } catch { result.textContent = 'Could not complete authorization. Return to the app and try again.'; }
})();
</script></html>'''.replace('NONCE', nonce)
    return HTMLResponse(html, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': f"default-src 'none'; script-src 'nonce-{nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"})


@router.post('/revolut/callback')
async def callback(request: Request, response: Response,
                   revolut_browser: str | None = Cookie(None), db: AsyncSession = Depends(get_db_session)):
    # Parse explicitly so FastAPI validation responses cannot echo a malformed authorization code.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 16384:
            raise HTTPException(400, 'Invalid Revolut callback', headers={'Cache-Control': 'no-store'})
    try:
        data = service.CallbackInput.model_validate(json.loads(body))
    except ValueError:
        raise HTTPException(400, 'Invalid Revolut callback', headers={'Cache-Control': 'no-store'}) from None
    try:
        result = await service.finish_authorization(data, revolut_browser, db)
    except HTTPException as exc:
        exc.headers = {'Cache-Control': 'no-store'}
        raise
    response.delete_cookie(COOKIE, path='/revolut/callback', secure=True, httponly=True, samesite='none')
    response.headers['Cache-Control'] = 'no-store'
    return result
