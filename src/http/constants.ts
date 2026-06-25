export const BASE_WWW = 'https://www.yodobashi.com';
export const BASE_ORDER = 'https://order.yodobashi.com';

export const API = {
  login:
    'https://order.yodobashi.com/yc/login/index.html?returnUrl=https%3A%2F%2Fwww.yodobashi.com%2F%3Flogout%3Dtrue%26yclogout%3Dtrue',
  getAccessToken: 'https://order.yodobashi.com/yc/ts/getAccessToken.html',
  memberIndex: 'https://order.yodobashi.com/yc/mypage/member/index.html',
  cartClear:
    'https://order.yodobashi.com/yc/shoppingcart/index.html?returnUrl=https%3A%2F%2Fwww.yodobashi.com%2F',
  cartAdd: 'https://order.yodobashi.com/yc/shoppingcart/add/index.html',
  cartNext: 'https://order.yodobashi.com/yc/shoppingcart/index.html?next=true',
  cartAction: 'https://order.yodobashi.com/yc/shoppingcart/action.html',
  orderIndex: 'https://order.yodobashi.com/yc/order/index.html',
  orderConfirm: 'https://order.yodobashi.com/yc/order/confirm/index.html?nodeStateKey=',
  orderConfirmAction: 'https://order.yodobashi.com/yc/order/confirm/action.html',
  orderDeliveryChange: 'https://order.yodobashi.com/yc/order/confirm/ajax/deliveryChange.html',
  orderPayment: 'https://order.yodobashi.com/yc/order/payment/index.html?nodeStateKey=',
  orderPaymentAction: 'https://order.yodobashi.com/yc/order/payment/action.html',
  orderReinput: 'https://order.yodobashi.com/yc/order/reinputcredit/index.html?nodeStateKey=',
  orderReinputAction: 'https://order.yodobashi.com/yc/order/reinputcredit/action.html',
  orderComplete: 'https://order.yodobashi.com/yc/order/complete/index.html?nodeStateKey=',
  orderHistory: 'https://order.yodobashi.com/yc/orderhistory/index.html',
} as const;

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export const PRODUCT_FIELD_PREFIX = 'products[0].';

export const IN_STOCK_CODES = new Set(['1', '2', '3', '4', '5']);
