const { createQorvexApiApp } = require('../dist/bootstrap');

let cachedApp = null;

async function getServer() {
  if (!cachedApp) {
    cachedApp = await createQorvexApiApp();
    await cachedApp.init();
  }

  return cachedApp.getHttpAdapter().getInstance();
}

module.exports = async function handler(request, response) {
  const server = await getServer();
  return server(request, response);
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};