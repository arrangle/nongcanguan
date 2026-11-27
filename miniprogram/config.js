// 小程序默认服务器地址
//
// 三种场景：
//   1. 开发者工具模拟器：http://localhost:3000
//   2. 真机 + 开发调试模式：http://<公网IP>:3000 或 https://临时隧道（都要在手机端「打开调试」）
//   3. 正式上线：https://<已备案域名>（并到小程序后台配置 request 合法域名）
//
// 用户也可以在首页右上角 ⚙ 里覆盖（存在本机，优先级最高）
module.exports = {
  // 当前线上实例（腾讯云 + cloudflared 临时隧道，重启隧道会换域名）
  BASE_URL: 'https://exports-getting-participant-parameters.trycloudflare.com',
};
