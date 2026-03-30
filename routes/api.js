'use strict';

const crypto = require('crypto');
const https = require('https');
const mongoose = require('mongoose');

const PROXY_BASE =
  'https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock';

function likesUseMemory() {
  return process.env.NODE_ENV === 'test' && !process.env.MONGO_URI;
}

const likeSchema = new mongoose.Schema({
  stock: { type: String, required: true },
  ipHash: { type: String, required: true }
});
likeSchema.index({ stock: 1, ipHash: 1 }, { unique: true });

const Like =
  mongoose.models.StockLike || mongoose.model('StockLike', likeSchema);

/** In-memory store for tests when MONGO_URI is not set (same semantics as MongoDB) */
const memoryLikeKeys = new Set();

function hashIp(ip) {
  const secret = process.env.IP_HASH_SECRET || 'stockchecker-ip-hash-secret';
  return crypto.createHash('sha256').update(String(ip) + secret).digest('hex');
}

function getClientIp(req) {
  const raw = req.ip || req.connection.remoteAddress || '0.0.0.0';
  return raw.replace(/^::ffff:/, '');
}

function httpsGet(url) {
  return new Promise(function (resolve, reject) {
    https
      .get(url, function (res) {
        var data = '';
        res.on('data', function (chunk) {
          data += chunk;
        });
        res.on('end', function () {
          resolve(data);
        });
      })
      .on('error', reject);
  });
}

function fetchQuote(symbol) {
  var url =
    PROXY_BASE + '/' + encodeURIComponent(symbol) + '/quote';
  return httpsGet(url).then(function (body) {
    var data = JSON.parse(body);
    if (
      typeof data === 'string' ||
      data.latestPrice === undefined ||
      data.latestPrice === null
    ) {
      var err = new Error('Invalid stock symbol');
      err.status = 400;
      throw err;
    }
    return data;
  });
}

function likeKey(stock, ipHash) {
  return stock + '\u0000' + ipHash;
}

function tryAddLike(stock, ipHash) {
  if (likesUseMemory()) {
    var key = likeKey(stock, ipHash);
    if (memoryLikeKeys.has(key)) return Promise.resolve(false);
    memoryLikeKeys.add(key);
    return Promise.resolve(true);
  }
  return Like.create({ stock: stock, ipHash: ipHash }).then(
    function () {
      return true;
    },
    function (err) {
      if (err && err.code === 11000) return false;
      throw err;
    }
  );
}

function countLikes(stock) {
  if (likesUseMemory()) {
    var n = 0;
    memoryLikeKeys.forEach(function (k) {
      if (k.split('\u0000')[0] === stock) n++;
    });
    return Promise.resolve(n);
  }
  return Like.countDocuments({ stock: stock });
}

function stockPricesHandler(req, res, next) {
  var stocks = req.query.stock;
  if (stocks === undefined || stocks === '') {
    return res.status(400).json({ error: 'stock query required' });
  }
  if (!Array.isArray(stocks)) stocks = [stocks];
  stocks = stocks
    .slice(0, 2)
    .map(function (s) {
      return String(s).trim().toUpperCase();
    })
    .filter(Boolean);
  if (stocks.length === 0) {
    return res.status(400).json({ error: 'stock query required' });
  }

  var like =
    req.query.like === 'true' || req.query.like === true;
  var ipHash = hashIp(getClientIp(req));

  Promise.all(stocks.map(fetchQuote))
    .then(function (quotes) {
      if (!like) {
        return Promise.resolve(quotes);
      }
      return Promise.all(
        stocks.map(function (sym) {
          return tryAddLike(sym, ipHash);
        })
      ).then(function () {
        return quotes;
      });
    })
    .then(function (quotes) {
      if (stocks.length === 1) {
        var sym = stocks[0];
        return countLikes(sym).then(function (likes) {
          res.json({
            stockData: {
              stock: sym,
              price: Number(quotes[0].latestPrice),
              likes: likes
            }
          });
        });
      }
      return Promise.all(stocks.map(countLikes)).then(function (likesArr) {
        var stockData = stocks.map(function (sym, i) {
          return {
            stock: sym,
            price: Number(quotes[i].latestPrice),
            rel_likes: likesArr[i] - likesArr[1 - i]
          };
        });
        res.json({ stockData: stockData });
      });
    })
    .catch(next);
}

module.exports = function (app) {
  ['/api/stock-prices', '/api/stock-prices/'].forEach(function (path) {
    app.route(path).get(stockPricesHandler);
  });
};
