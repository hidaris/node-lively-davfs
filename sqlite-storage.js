"use strict"

var util = require("util");
var lvFsUtil = require("./util");
var path = require("path");
var EventEmitter = require("events").EventEmitter;
var d = require('./domain');
var async = require('async');
var sqlite3 = require('sqlite3').verbose();

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function log(/*args*/) { console.log.apply(console, arguments); }

function dateString(d) {
    if (d.constructor === Date) return d.toISOString();
    if (typeof d === "number") return dateString(new Date(d));
    if (typeof d === "string" && /^[0-9]+$/.test(d)) return dateString(Number(d));
    return d;
}

function sqlPrep(db, stmt) { return db.prepare(stmt, function(err) { console.log(err) }); }

function run(db, stmt, args, thenDo) {
    if (typeof args === 'function') thenDo = args;
    db.run(stmt, args, function(err) {
        if (err) log('err: ', err);
        else log('%s -- lastID: %s, changes: %s', stmt, this.lastID, this.changes);
        thenDo(err, {lastID: this.lastID, changes: this.changes});
    });
}

function query(db, stmt, args, thenDo) {
    if (typeof args === 'function') thenDo = args;
    var rows = [];
    try {
        db.all(stmt, args, function(err, rows) {
            err && log('Query error %s, %s: %s', stmt, args, err);
            thenDo && thenDo(err, rows);
        });
    } catch(e) {
        log('Query error %s, %s: %s', stmt, args, e);
        thenDo && thenDo(e, []);
    }
    // in case we want to stream responses at some point:
    // db.each(stmt, args,
    //     function(err, row) {
    //         if (err) log('err: ', err); else rows.push(row);
    //     }, function(err, noRows) {
    //         if (err) log('err: ', err); else log('%s: #%s', stmt, noRows);
    //         thenDo && thenDo(err, rows);
    //     });
}

function initFSTables(db, reset, thenDo) {
    var tasks = [];
    if (reset) {
        tasks = tasks.concat([
            lvFsUtil.curry(run, db, 'DROP TABLE IF EXISTS versioned_objects'),
            lvFsUtil.curry(run, db, "DROP INDEX IF EXISTS versioned_objects_date_index;"),
            lvFsUtil.curry(run, db, "DROP INDEX IF EXISTS versioned_objects_index;")]);
    }
    tasks = tasks.concat([
        lvFsUtil.curry(run, db,
            "CREATE TABLE IF NOT EXISTS versioned_objects ("
          + "  path TEXT,"
          + "  version INTEGER NOT NULL DEFAULT 0,"
          + "  change TEXT,"
          + "  author TEXT,"
          + "  date DATETIME DEFAULT CURRENT_TIMESTAMP,"
          + "  content TEXT,"
          + "  PRIMARY KEY(path,version));"),
        lvFsUtil.curry(run, db, "CREATE INDEX IF NOT EXISTS versioned_objects_index ON versioned_objects(path,version);"),
        lvFsUtil.curry(run, db, "CREATE INDEX IF NOT EXISTS versioned_objects_date_index ON versioned_objects(date,path);")]);
    async.series(tasks, function(err) {
        log('DONE: CREATE TABLES', err);
        thenDo && thenDo(err);
    });
}

function storeVersionedObjects(db, dataAccessors, options, thenDo) {
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
                          data.author, dateString(data.date),
                          data.content, data.path];
            stmt.run.apply(stmt, fields.concat([afterInsert]));
            // db can run stuff in parallel, no need to wait for stmt to finsish
            // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
            function afterInsert(err) {
                if (err) {
                    console.error('Error inserting %s: %s', data && data.path, err);
                } else {
                    importCount++;
                    console.log("... done storing %s", data.path);
                }
                taskCount--;
                next();
                if (taskCount > 0) return;
                stmt.finalize();
                console.log("stored new versions of %s objects", importCount);
                thenDo && thenDo();
            }
        });
    }
    var taskCount = dataAccessors.length,
        importCount = 0,
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

function SQLiteStore(options) {
    this.db = null;
    this.dbFile = options.dbFile || ":memory:";
    EventEmitter.call(this);
    // Object.freeze(this);
}

util._extend(SQLiteStore.prototype, EventEmitter.prototype);

util._extend(SQLiteStore.prototype, d.bindMethods({

    reset: function(emptyTables, thenDo) {
        this.db = new sqlite3.Database(this.dbFile);
        initFSTables(this.db, emptyTables, thenDo);
    },

    storeAll: function(versionDataSets, options, thenDo) {
        var accessors = versionDataSets.map(function(dataset) {
            return function(callback) { callback(null, dataset); }; });
        storeVersionedObjects(this.db, accessors, options, thenDo);
    },

    getRecordsFor: function(path, thenDo) {
        this.getRecords({paths: [path]}, thenDo);
    },

    getRecords: function(spec, thenDo) {
        // generic query maker for version records. Example: get date and
        // content of most recent version of most recent version of "foo.txt":
        // this.getVersions({paths: ["foo.txt"], attributes: ['date','content'], newest: true});
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // spec = {
        //   groupByPaths: BOOL, -- return an object with rows grouped (keys of result)
        //   attributes: [STRING], -- which attributes to return from stored records
        //   newest: BOOL, -- only return most recent version of a recored
        //   paths: [STRING], -- filter records by path names
        //   version: [STRING|NUMBER], -- the version number
        //   date: [DATE|STRING], -- last mod date
        //   newer: [DATE|STRING], -- last mod newer
        //   older: [DATE|STRING], -- last mod older
        //   limit: [NUMBER]
        // }
        spec = spec || {};
        // SELECT caluse
        var attrs = spec.attributes || ["path","version","change","author","date","content"];
        if (spec.groupByPaths && attrs.indexOf('path') === -1) attrs.push('path');
        var select = util.format("SELECT %s FROM versioned_objects objs", attrs.join(','));
        // WHERE clause
        var where = 'WHERE';
        where += ' ('
               + (spec.paths ?
                  spec.paths.map(function(path) {
                        return "objs.path = '" + path.replace(/\'/g, "''") + "'";
                   }).join(' OR ') : "objs.path IS NOT NULL")
               + ')';
        if (spec.date) {
            where += " AND objs.date = '" + dateString(spec.date) + "'";
        }
        if (spec.newer) {
            where += " AND objs.date > '" + dateString(spec.newer) + "'";
        }
        if (spec.older) {
            where += " AND objs.date <= '" + dateString(spec.older) + "'";
        }
        if (spec.newest) {
            where += " AND objs.version = (\n"
                  + "SELECT max(version) AS newestVersion\n"
                  + "FROM versioned_objects objs2 WHERE objs2.path = objs.path)";
        } else if (spec.version) {
            where += " AND objs.version = '" + spec.version + "'";
        }
        // ORDER BY
        var orderBy = "ORDER BY version DESC";
        // limit
        var limit = typeof spec.limit === 'number' ? 'LIMIT ' + spec.limit : '';
        // altogether
        var sql = [select, where, orderBy, limit].join(' ');
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        var whenDone = spec.groupByPaths ?
            function(err, rows) {
                if (err) { thenDo(err, {}); return; }
                thenDo(null, rows.reduce(function(resultByPaths, row) {
                    var pathRows = resultByPaths[row.path] || (resultByPaths[row.path] = [])
                    pathRows.push(row);
                    return resultByPaths;
                }, {}));
            } : thenDo;
        query(this.db, sql, [], whenDone);
    }

}));

module.exports = SQLiteStore;
