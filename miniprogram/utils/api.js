const { BASE_URL } = require('../config');

function base() {
  const app = getApp();
  const fromApp = app && app.globalData && app.globalData.apiBase;
  return (fromApp || wx.getStorageSync('nongcanguan-api-base') || BASE_URL).replace(/\/+$/, '');
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: base() + path,
      method: options.method || 'GET',
      data: options.data,
      header: { 'content-type': 'application/json' },
      timeout: 12000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const message = (res.data && res.data.error) || ('请求失败（HTTP ' + res.statusCode + '）');
        const error = new Error(message);
        error.statusCode = res.statusCode;
        error.data = res.data;
        reject(error);
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络连接失败，请检查服务器地址'));
      },
    });
  });
}

module.exports = {
  base,
  request,
  getMenu: () => request('/api/menu'),
  getSummary: () => request('/api/summary'),
  getQueues: () => request('/api/queues'),
  getDish: (id) => request('/api/dishes/' + encodeURIComponent(id)),
  postQueue: (data) => request('/api/queues', { method: 'POST', data }),
  postReview: (id, data) => request('/api/dishes/' + encodeURIComponent(id) + '/reviews', { method: 'POST', data }),
  getLeaderboard: (type) => request('/api/leaderboard?type=' + (type || 'rating')),
  likeReview: (id, deviceId) => request('/api/reviews/' + encodeURIComponent(id) + '/like', {
    method: 'POST',
    data: { deviceId },
  }),
};
