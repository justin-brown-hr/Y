import type { Account } from '../config.js';
import { API } from './constants.js';
import type { HttpSession } from './http-session.js';
import { CheckoutError } from '../utils/errors.js';

export async function loginWithHttp(
  session: HttpSession,
  account: Account,
  log: (msg: string) => void,
): Promise<void> {
  log('Login via HTTP POST');
  const loginPage = await session.get(API.login);
  if (loginPage.status >= 400) {
    throw new CheckoutError(`Login page HTTP ${loginPage.status}`, 'proxy_error', true);
  }

  const res = await session.postForm(
    API.login,
    {
      memberId: account.email,
      password: account.password,
      returnUrl: 'https://www.yodobashi.com/?logout=true&yclogout=true',
    },
    API.login,
  );

  const body = String(res.data);
  const finalUrl = session.finalUrl(res);

  if (body.includes('captcha') || body.includes('CAPTCHA')) {
    throw new CheckoutError('CAPTCHA detected during login', 'captcha_blocked');
  }

  const loggedIn =
    finalUrl.includes('yodobashi.com') &&
    (!body.includes('js_i_login0') || body.includes('ログアウト') || body.includes('memberName'));

  if (!loggedIn && res.status >= 400) {
    throw new CheckoutError('HTTP login failed — check credentials', 'login_failed');
  }

  if (!loggedIn) {
    throw new CheckoutError('HTTP login did not establish session', 'login_failed');
  }

  log('HTTP login successful');
}
