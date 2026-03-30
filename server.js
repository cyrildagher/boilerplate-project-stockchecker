'use strict';
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

const apiRoutes = require('./routes/api.js');
const fccTestingRoutes = require('./routes/fcctesting.js');
const runner = require('./test-runner');

const app = express();

app.set('trust proxy', true);

// Content Security Policy: only scripts and styles may load from this origin (user story 2).
app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    },
    browserSniff: false
  })
);

app.use('/public', express.static(process.cwd() + '/public'));

app.use(cors({ origin: '*' })); //For FCC testing purposes only

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

//Index page (static HTML)
app.route('/').get(function (req, res) {
  res.sendFile(process.cwd() + '/views/index.html');
});

//For FCC testing purposes
fccTestingRoutes(app);

var mongoUri =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/stockchecker';
var skipMongo =
  process.env.NODE_ENV === 'test' && !process.env.MONGO_URI;

if (!skipMongo) {
  mongoose.connect(mongoUri);
}

//Routing for API
apiRoutes(app);

// API error handler
app.use(function (err, req, res, next) {
  if (res.headersSent) return next(err);
  var status = err.status || 500;
  res.status(status).json({ error: err.message || 'Server error' });
});

//404 Not Found Middleware
app.use(function (req, res) {
  res.status(404).type('text').send('Not Found');
});

//Start our server and tests!
var listener = app.listen(process.env.PORT || 3000, function () {
  console.log('Your app is listening on port ' + listener.address().port);
  if (process.env.NODE_ENV === 'test') {
    console.log('Running Tests...');
    setTimeout(function () {
      try {
        runner.run();
      } catch (e) {
        console.log('Tests are not valid:');
        console.error(e);
      }
    }, 3500);
  }
});

module.exports = app; //for testing
