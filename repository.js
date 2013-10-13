"use strict"

var util = require("util");
var fs = require("fs");
var path = require("path");
var EventEmitter = require("events").EventEmitter;
var livelyDAVPlugin = require('./jsDAV-plugin');
var VersionedFileSystem = require('./VersionedFileSystem');
var d = require('./domain');

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
global.dir = function(obj, depth) {
    console.log(util.inspect(obj, {depth: depth || 0}));
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// Repo
function Repository(options) {
    try {
        EventEmitter.call(this);
        this.initialize(options);
    } catch(e) { this.emit('error', e); }
}

util._extend(Repository.prototype, EventEmitter.prototype);

util._extend(Repository.prototype, d.bindMethods({

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // intialize-release
    initialize: function(options) {
        if (global.lively) {
            lively.repository = this;
        }
        this.fs = new VersionedFileSystem(options);
        // we keep a queue for changes b/c they should be committed to the
        // versioned file system in their incoming order. Before they can be
        // committed async work has to to done, though, which might intermix the
        // change order
        this.pendingChangeQueue = [];
        this.fs.once('initialized', function() {
            this.emit('initialized');
        }.bind(this));
        Object.freeze(this);
    },

    start: function(resetDatabase, thenDo) {
        // resetDatabase = drop what was stored previously
        this.fs.initializeFromDisk(resetDatabase, thenDo);
    },

    close: function(thenDo) {
        this.emit('closed');
        thenDo && thenDo(null);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // DAV
    getDAVPlugin: function() {
        return livelyDAVPlugin.onNew(this.attachToDAVPlugin.bind(this));
    },
    attachToDAVPlugin: function(plugin) {
        plugin.on('fileChanged', this.onFileChange.bind(this));
        plugin.on('afterFileChanged', this.onAfterWrite.bind(this));
        plugin.on('fileCreated', this.onFileCreation.bind(this));
        plugin.on('afterFileCreated', this.onAfterWrite.bind(this));
        plugin.on('fileDeleted', this.onFileDeletion.bind(this));
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // change recording
    isSynchronized: function() { return this.pendingChangeQueue.length === 0; },

    commitPendingChanges: function() {
        var repo = this,
            q = this.pendingChangeQueue,
            toCommit = [];
        for (var i = 0; i < q.length; i++) {
            if (!q[i].canBeCommitted()) break;
            toCommit.push(q[i].record);
        }
        if (!toCommit.length) return;
        repo.pendingChangeQueue.splice(0, toCommit.length);
        repo.fs.addVersions(toCommit, {}, function(err, version) {
            if (err) {
                console.error('error in addVersions for records ', toCommit);
            }
            if (!repo.pendingChangeQueue.length) {
                console.log("all pending changes process");
                repo.emit('synchronized');
            }
        });
    },

    discardPendingChange: function(change) {
        var idx = this.pendingChangeQueue.indexOf(change);
        if (idx === -1) return;
        this.pendingChangeQueue.splice(idx, 1);
        if (idx === 0) this.commitPendingChanges();
    },

    onAfterWrite: function(evt) {
        console.log('after write: ', evt.uri);
        if (!evt.uri) return;
        var q = this.pendingChangeQueue, change;
        for (var i = 0; i < q.length; i++)
            if (q[i].record.path === evt.uri) { change = q[i]; break; }
        if (!change) return;
        this.readFileStat(change);
    },

    captureDAVEvt: function(changeType, readBody, readStat, evt) {
        if (!evt.uri) { console.log('Error recording file change, no path', evt); return; }
        var taskData = {
            record: {
                version: undefined,
                change: changeType,
                author: evt.username || 'unknown',
                date: '',
                content: evt.req && evt.req.body ? evt.req.body : null,
                path: evt.uri,
                stat: evt.stat
            },
            canBeCommitted: function() {
                var waitForStat = readStat && !this.statRead,
                    waitForBody = readBody && !this.requestDataRead;
                return !waitForBody && !waitForStat;
            },
            requestDataRead: false,
            statRead: !!evt.stat || false,
            request: evt.req,
            incomingContent: evt.content
        }
        this.pendingChangeQueue.push(taskData);
        readBody && this.startReadingRequestContent(taskData);
        if (!readBody && !readStat) this.commitPendingChanges();
    },

    onFileChange: function(evt) {
        console.log('file change: ', evt.uri);
        this.captureDAVEvt('contentChange', true, true, evt);
    },

    onFileCreation: function(evt) {
        console.log('file created: ', evt.uri);
        this.captureDAVEvt('created', true, true, evt);
    },

    onFileDeletion: function(evt) {
        console.log('file deleted: ', evt.uri);
        this.captureDAVEvt('deletion', false, false, evt);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // change processing
    startReadingRequestContent: function(change, startTimestamp) {
        var repo = this;
        if (!change.incomingContent) change.requestDataRead = true;
        if (change.requestDataRead) { this.commitPendingChanges(); return; }
        var timeout = 1*1000, ts = Date.now();
        if (!startTimestamp) startTimestamp = ts;
        if (ts-startTimestamp > timeout) {
            console.log("reading content for %s timed out", change.record.path);
            change.requestDataRead = true;
            this.commitPendingChanges();
            return
        }
        console.log("waiting for content of %s", change.record.path);
        if (!change.incomingContent.isDone) {
            setTimeout(this.startReadingRequestContent.bind(
                this, change, startTimestamp), 100);
            return;
        }
        change.record.content = change.incomingContent.buffer.toString();
        change.requestDataRead = true;
        console.log("content for %s read", change.record.path);
        repo.commitPendingChanges();
    },

    readFileStat: function(change) {
        var repo = this;
        console.log("start reading file stat for %s", change.record.path);
        fs.stat(path.join(repo.getRootDirectory(), change.record.path), function(err, stat) {
            if (err || !stat) {
                console.error('readFileStat: ', err);
                repo.discardPendingChange(change);
                return;
            }
            console.log("file stat for %s read", change.record.path);
            change.record.stat = stat;
            change.record.date = stat.mtime.toISOString();
            change.statRead = true;
            repo.commitPendingChanges();
        });
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessors
    getRootDirectory: function() { return this.fs.getRootDirectory(); },
    getFiles: function(thenDo) { this.fs.getFiles(thenDo); },
    getFileRecord: function(options, thenDo) { return this.fs.getFileRecord(options, thenDo); },
    getRecords: function(options, thenDo) { return this.fs.getRecords(options, thenDo); },
    getVersionsFor: function(path, thenDo) { return this.getRecords({paths: [path]}, thenDo); },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // debugging
    logState: function() {
        console.log('log repo state:');
        console.log("versionedFileInfos: ");
        dir(this.fs, 1);
    }
}));


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
module.exports = Repository;
