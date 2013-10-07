"use strict"

var util = require("util");
var async = require("async");
var path = require("path");
var findit = require('findit');
var jsDAV = require(path.join("jsdav/lib/jsdav"));
var livelyDAVPlugin = require('./jsDAV-plugin');

global.dir = function(obj) {
    console.log(util.inspect(obj, {depth: 0}));
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// domain / error handling
var d = require('domain').create();
d.on('error', function(err) {
    console.error('Encountered error: ', err.stack);
    process.exit();
});

d.bindMethods = function(obj) {
    var result = [];
    Object.keys(obj).forEach(function(name) { 
        var val = obj[name];
        if (typeof val === 'function') val = d.bind(val);
        result[name] = val;
    });
    return result;
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// eval server helper
var evalServer;
function openEvalInterface(port, thenDo) {
    if (evalServer) {
        closeEvalInterface(function() { openEvalInterface(port, thenDo); });
        return;
    }
    var subserverStart = require('../lively-server-inspector'),
        server = require('../lively-pluggable-server'),
        port = port || 9009, server;
    subserverStart.route = '/inspect';
    console.log('starting lively server inspector on port ', port);
    server.start({port: port, subservers: [subserverStart]}, function(err, server) {
        evalServer = server; thenDo(null); });
}
function closeEvalInterface(thenDo) {
    if (!evalServer) { thenDo(); return }
    evalServer.close(function() { evalServer = null; thenDo() })
}
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// DAV
function startDAV(davPlugin, fsPath, port, thenDo) {
    var davServer = jsDAV.createServer({
        node: fsPath || process.cwd(),
        plugins: {livelydav: davPlugin}}, port);
global.davServer = davServer;
    davServer.once('listening', function() { thenDo(null, davServer); });
    davServer.on('close', function() { console.log("dav server closed");});
}

function closeDAV(davServer, thenDo) {
    davServer.close(function() { console.log('closed dav server'); thenDo(null); });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// versioning data structures
/*
 * maps paths to list of versions
 * a version is {
 *   path: STRING,
 *   version: STRING||NUMBER,
 *   stat: FILESTAT,
 *   change: STRING
 * }
 * a change is what kind of operation the version created:
 * ['initial', 'creation', 'deletion', 'contentChange']
 */
var versionedFileInfos = {};
function addVersion(versionedFileInfos, versionId, change, fileinfo) {
    var versions = versionedFileInfos[fileinfo.path]
                || (versionedFileInfos[fileinfo.path] = []);
    // if no versionId specified we try to auto increment:
    if (versionId === undefined) {
        var lastVersion = versions[versions.length-1];
        versionId = lastVersion ? lastVersion.version + 1 : 0;
    }
    var version = {
        change: change, version: versionId,
        path: fileinfo.path, stat: fileinfo.stat,
    };
    versions.push(version);
    return version;
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// Repo
function Repository(options) {
    this.davServer = null;
    this.port = options.port;
    this.fs = options.fs;
    this.excludedDirectories = options.excludedDirectories || [];
}

util._extend(Repository.prototype, d.bindMethods({
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // initializing
    initializeFromFS: function(thenDo) {
        var addInitialVersion = addVersion.bind(null, versionedFileInfos, 0, 'initial');
        this.walkFiles(function(err, result) {
            result.files.forEach(addInitialVersion);
            thenDo(null);
        });
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // DAV
    setDAVServer: function(davServer) { return this.davServer = davServer; },
    getDAVServer: function(davServer) { return this.davServer; },

    attachToDAVPlugin: function(plugin) {
        plugin.on('fileChanged', this.onFileChange.bind(this));
        plugin.on('fileCreated', this.onFileCreation.bind(this));
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // change recording
    onFileChange: function(evt) {
        console.log('file change: ', evt.uri);
        addVersion(versionedFileInfos, undefined, 'contentChange', {path: evt.uri});
    },

    onFileCreation: function(evt) {
        console.log('file created: ', evt.uri);
        addVersion(versionedFileInfos, 0, 'created', {path: evt.uri});
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessors
    getFiles: function(thenDo) {
        var lastVersions = Object.keys(versionedFileInfos).map(function(path) {
            return versionedFileInfos[path].slice(-1)[0]; });
        thenDo(null, lastVersions);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // fs access
    walkFiles: function(thenDo) {
        var root = this.fs,
            find = findit(this.fs),
            result = {files: [], directories: []},
            ignoredDirs = this.excludedDirectories || [],
            ended = false;
        find.on('directory', function (dir, stat, stop) {
            var base = path.basename(dir);
            result.directories.push({path: dir, stat: stat});
            if (ignoredDirs.indexOf(base) >= 0) stop();
        });
        find.on('file', function (file, stat) {
            result.files.push({
                path: path.relative(root, file),
                stat: stat
            });
        });
        find.on('link', function (link, stat) {});
        var done = false;
        function onEnd() {
            if (done) return;
            done = true; thenDo(null, result);
        }
        find.on('end', onEnd);
        find.on('stop', onEnd);
    }

}));

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// module interface / initialize-release
function logProgress(msg) {
    return function(thenDo) { console.log(msg); thenDo && thenDo(); }
}

function start(options, thenDo) {
    if (!options.fs) options.fs = process.cwd();
    if (!options.port) options.port = 9032;
    var davServer, davPlugin, repository;
    async.series([
        logProgress('1) start'),
        function(next) {
            repository = new Repository(options);
            repository.initializeFromFS(next);
        },
        logProgress('2) repo created'),
        function(next) {
            davPlugin = livelyDAVPlugin.onNew(function(plugin) {
                repository.attachToDAVPlugin(plugin); });
            next();
        },
        logProgress('3) dav plugin setup'),
        function(next) {
            startDAV(davPlugin, options.fs, options.port, function(err, s) {
                repository.setDAVServer(s); next(err); })
        },
        logProgress('4) dav server listening'),
        function(next) { Object.freeze(repository); next(); },
        openEvalInterface.bind(null, options.port+1),
        logProgress('5) eval interface listening'),
    ], function(err) { thenDo(err, repository); });
}

function stop(repo, thenDo) {
    async.series([
        closeEvalInterface,
        logProgress('eval interface stopped'),
        closeDAV.bind(null, repo.getDAVServer()),
        logProgress('dav stopped'),
    ], thenDo);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
module.exports = {start: start, stop: stop};
