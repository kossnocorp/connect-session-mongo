/**
* Based on the following classes:
* https://github.com/senchalabs/connect/tree/master/lib/connect/middleware/session/memory.js
* https://github.com/ciaranj/express-session-mongodb
* https://github.com/davglass/express-session-mongodb
*/
var mongo = require('mongodb'),
    //util = require(process.binding('natives').util ? 'util' : 'sys'),
    Store = require('connect').session.Store,
    util = require('util'),
    Db = mongo.Db,
    Connection = mongo.Connection,
    Server = mongo.Server;

var MongoStore = module.exports = function(options, cb) {
    options = options || {};
    Store.call(this, options);

    var server,
        dbName = options.db || 'connect-sessions',
        ip = options.ip || '127.0.0.1',
        port = options.port || 27017;

    this._collection = options.collection || 'sessions';

    if (options.server) {
        server = options.server;
    } else {
        server= new Server(ip, port, {auto_reconnect: true}, {});
    }

    var self = this;

    if (options.url) {
        var connectCallback = function(self) {
           return function(err, returnedInstance) {
              if (err) {
                 if (cb) {cb(err);} else {console.log(err);}
              } else {
                 self._db = returnedInstance;
                 //console.log('session store initialized\n');
                 if (cb) {cb(null, returnedInstance);}
              }
           };
        };

        Db.connect(options.url, { db: { safe: true } }, connectCallback(this));
    } else {
      this._db = new Db(dbName, server, { safe: true });

      var openCallback = function (db) {
        if (options.timeout) {
            setupTimeout(db, self._collection, options.timeout, function () {
                if (cb) { cb(null, db); }
            });
        }
        else {
            disableTimeout(db, self._collection, function () {
                if (cb) { cb(null, db); }
            });
        }
      };
      this._db.open(function(err, db) {
         if (err) {if (cb) {cb(err);} else {console.log(err);} return;}
         //console.log('session store initialized\n');
         if (options.username && options.password) {
           db.authenticate(options.username, options.password, function () {
             openCallback(db);
           });
         }
         else {
           openCallback(db);
         }
      });
    }
}

util.inherits(MongoStore, Store);

MongoStore.prototype.set = function(sid, sess, fn) {
    this._db.collection(this._collection, function(err, collection) {
        // We encode the session id in mongo's _id primary key field for indexing purposes.
        var clone = { _id: sid, lastAccessed: new Date(), sessionData: cloneOwnProperties(sess) };
        collection.save(clone, function(err, document) {
          if (!err) {
            fn && fn(null, sess);
          }
        });
    });
};

MongoStore.prototype.get = function(sid, fn) {
    this._db.collection(this._collection, function(err, collection) {
        collection.findOne({ _id: sid }, function(err, session_data) {
            if (err) {
                fn && fn(err);
            } else {
                if (session_data && session_data.sessionData) {
                    session_data = cleanSessionData(session_data.sessionData);
                }
                fn && fn(null, session_data);
            }
        });
    });
};

MongoStore.prototype.destroy = function(sid, fn) {
    this._db.collection(this._collection, function(err, collection) {
        collection.remove({ _id: sid }, function() {
            fn && fn();
        });
    });
};

MongoStore.prototype.length = function(fn) {
    this._db.collection(this._collection, function(err, collection) {
        collection.count(function(count) {
            console.log('Session has: ', count);
            fn && fn(null, count);
        });
    });
};

MongoStore.prototype.all = function(fn) {
    var arr = [];
    this._db.collection(this._collection, function(err, collection) {
        collection.find(function(err, cursor) {
            cursor.each(function(d) {
                d = cleanSessionData(d);
                arr.push(d);
            });
            fn && fn(null, arr);
        });
    });
};

MongoStore.prototype.clear = function(fn) {
    this._db.collection(this._collection, function(err, collection) {
        collection.remove(function() {
            fn && fn();
        });
    });
};

var setupTimeout = function (db, collection, timeout, callback) {
    db.collection(collection, function(err, collection) {
        collection.ensureIndex('lastAccessed', { name: 'timeout', expireAfterSeconds: timeout }, callback);
    });
};

var disableTimeout = function (db, collection, callback) {
    db.collection(collection, function(err, collection) {
        collection.dropIndex('timeout', callback);
    });
};

var cleanSessionData = function(json) {
    var data = {};
    for (var i in json) {
        data[i] = json[i];
        // lastAccess is a Unix timestamp which mongo stores as a 2 component Long object. Convert it back to number.
        if (data[i] instanceof mongo.BSONPure.Long) {
            data[i] = data[i].toNumber();
        }
    }
    return data;
};

/**
 * There is a problem in Mongo's Native & Pure drivers in that functions of the session's prototype are also saved to
 * mongo. Cloning just the session's own properties is a workaround.
 *
 * @param original {Object} The session object whose own properties should be cloned.
 */
var cloneOwnProperties = function(original) {
  var i;
  var copy = {};
  for (i in original) {
    if (original.hasOwnProperty(i)) {
      copy[i] = original[i];
    }
  }
  return copy;
};