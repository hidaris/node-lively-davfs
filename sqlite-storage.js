"use strict"

var util = require("util");
var path = require("path");
var EventEmitter = require("events").EventEmitter;
var d = require('./domain');
var async = require('async');
var sqlite3 = require('sqlite3').verbose();

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function log(/*args*/) { console.log.apply(console, arguments); }

function sqlPrep(db, stmt) { return db.prepare(stmt, function(err) { console.log(err) }); }

function run(db, stmt, args, thenDo) {
    db.run(stmt, args, function(err) {
        if (err) log('err: ', err);
        else log('%s -- lastID: %s, changes: %s', stmt, this.lastID, this.changes);
        thenDo(err, {lastID: this.lastID, changes: this.changes});
    });
}

function query(db, stmt, args, thenDo) {
    var rows = [];
    db.all(stmt, args, thenDo);
    // db.each(stmt, args,
    //     function(err, row) {
    //         if (err) log('err: ', err); else rows.push(row);
    //     }, function(err, noRows) {
    //         if (err) log('err: ', err); else log('%s: #%s', stmt, noRows);
    //         thenDo && thenDo(err, rows);
    //     });
}

function initTable(db, tableName, createStmt) {
    return function(next) {
        db.serialize(function() {
            db.run('DROP TABLE IF EXISTS '+ tableName, function(err) {
                log('DROP TABLE', tableName, err);
            });
            db.run(createStmt, function(err) {
                err && log('error: ', err);
                next(err); });
            });
    }
}

function initFSTables(db, thenDo) {
    async.parallel([
        initTable(db, "versioned_objects",
            "CREATE TABLE versioned_objects (\n"
          + "    path TEXT,\n"
          + "    version TEXT NOT NULL DEFAULT '0',\n"
          + "    change TEXT,\n"
          + "    author TEXT,\n"
          + "    date TEXT,\n"
          + "    content TEXT,\n"
          + "    PRIMARY KEY(path,version)\n"
          + ");\n"
          + "CREATE INDEX ON versioned_objects(path,version);"),
    ], function(err) {
        log('DONE: CREATE TABLES', err);
        thenDo && thenDo(err);
    });
}

function storeVersionedObjects(db, dataAccessors, thenDo) {
    // this batch-processes worlds inserts
    // worldDataAccessors is an array of functions that expect one parameter, a
    // callback, that in turn has an error callback and an object
    // {uri, version,json} this should be stored in the db
    // queued so that we do not start open file handles to all worlds at once
    function afterInsert() {}
    function worker(accessor, next) {
        accessor(function(err, data) {
            if (err) {
                console.log('Could not access %s: ', data, err);
                taskCount--; next(); return;
            }
            console.log("storing %s...", data.path);
            var fields = [data.path, data.change,
                          data.author, data.date,
                          data.content, data.path];
            stmt.run.apply(stmt, fields.concat([afterInsert]));
            // db can run stuff in parallel, no need to wait for stmt to finsish
            // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
            function afterInsert(err) {
                if (err) {
                    console.error('Error inserting %s: %s', data && data.path, err);
                } else {
                    console.log("... done storing %s", data.path);
                }
                taskCount--;
                next();
                if (taskCount > 0) return;
                stmt.finalize();
                console.log("all worlds imported!");
                thenDo && thenDo();
            }
        });
    }
    var taskCount = dataAccessors.length,
        parallelReads = 10,
        sqlInsertStmt = 'INSERT INTO versioned_objects '
                      + 'SELECT ?, ifnull(x,0), ?, ?, ?, ? '
                      + 'FROM (SELECT max(CAST(objs2.version as integer)) + 1 AS x '
                      + '      FROM versioned_objects objs2 '
                      + '      WHERE objs2.path = ?);',
        stmt = db.prepare(sqlInsertStmt, function(err) {
            // this callback is needed, when it is not defined the server crashes
            // but when it is there the stmt.run callback also seems the catch the error...
            err && console.error('error in sql %s: %s', sqlInsertStmt, err); }),
        q = async.queue(worker, parallelReads);
    q.push(dataAccessors);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function SQLiteStore() {
    this.db = null;
    EventEmitter.call(this);
    // Object.freeze(this);
}

util._extend(SQLiteStore.prototype, EventEmitter.prototype);

util._extend(SQLiteStore.prototype, d.bindMethods({

    reset: function(emptyTables, thenDo) {
        // this.db = new sqlite3.Database(':memory:');
        this.db = new sqlite3.Database(path.join(process.cwd(), "world-db-expt2.sqlite"));
        if (emptyTables) initFSTables(this.db, thenDo);
        else thenDo(null);
    },

    store: function(versionData, thenDo) {
        this.storeAll([versionData], thenDo);
    },

    storeAll: function(versionDataSets, thenDo) {
        var accessors = versionDataSets.map(function(dataset) {
            return function(callback) { callback(null, dataset); }; });
        storeVersionedObjects(this.db, accessors, thenDo);
    },

    getVersionsFor: function(fn, thenDo) {
        var sql = "SELECT * FROM versioned_objects "
                + "WHERE path = ? ";
                + "ORDER BY CAST(version as integer);";
        query(this.db, sql, [fn], thenDo);
    },

    dump: function(thenDo) { // get all versions
        var sql = "SELECT * FROM versioned_objects GROUP BY path,version;"
        // query(this.db, sql, [], thenDo);
        query(this.db, sql, [], function(err, rows) {
            // console.log(rows);
            // FIXME!
            var result = rows.reduce(function(result, row) {
                var last = result[result.length-1];
                if (last && last[0].path === row.path) { last.push(row); }
                else { result.push([row]); }
                return result;
            }, []);
            thenDo(err,result);
        });
    }

}));

module.exports = SQLiteStore;
