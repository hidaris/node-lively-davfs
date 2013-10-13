"use strict";

function log(/*arguments*/) {
    process.stdout.write('livelyDAV: ');
    return console.log.apply(console, arguments);
}

var util = require('util');
var concat = require('concat-stream')

var EventEmitter = require('events').EventEmitter;
var jsDAVPlugin = require("jsDAV/lib/DAV/plugin");

var livelyDAVPlugin = module.exports = jsDAVPlugin.extend({
    name: "livelydav",
    initialize: function(handler) {
        this.handler = handler;
        this._putContent = null;
        handler.addEventListener("beforeMethod", this.beforeMethod.bind(this));
        handler.addEventListener("afterCreateFile", this.afterCreateFile.bind(this));
        handler.addEventListener("afterWriteContent", this.afterWriteContent.bind(this));
        handler.addEventListener("beforeCreateFile", this.beforeCreateFile.bind(this));
        handler.addEventListener("beforeWriteContent", this.beforeWriteContent.bind(this));
        handler.addEventListener("beforeUnbind", this.beforeUnbind.bind(this));
    },
    beforeMethod: function(e, method) {
        if (method.toLowerCase() === 'put') {
            var req = this.handler.httpRequest,
                content = {buffer: null, isDone: false},
                write = concat(function(data) {
                    content.buffer = data;
                    content.isDone = true });
            req.pipe(write);
            this._putContent = content;
        }
        return e.next();
    },
    beforeWriteContent: function(e, uri, node) {
        var req = this.handler.httpRequest,
            username = global.lively&& global.lively.userData && global.lively.userData.getUserName(req);
        this.emit('fileChanged', {
            username: username,
            uri: uri,
            req: req,
            content: this._putContent});
        this._putContent = null;
        return e.next();
    },
    afterWriteContent: function(e, uri) {
        this.emit('afterFileChanged', {uri: uri});
        return e.next();
    },
    beforeCreateFile: function(e, uri, data, encoding, node) {
        var req = this.handler.httpRequest,
            username = global.lively&& global.lively.userData&& global.lively.userData.getUserName(req);
        this.emit('fileCreated', {
            username: username,
            uri: uri,
            req: req,
            content: this._putContent});
        this._putContent = null;
        return e.next();
    },
    afterCreateFile: function(e, uri) {
        var req = this.handler.httpRequest,
            username = global.lively&& global.lively.userData&& global.lively.userData.getUserName(req);
        this.emit('afterFileCreated', {uri: uri, username: username, req: req});
        return e.next();
    },
    beforeUnbind: function(e, uri) {
        this.emit('fileDeleted', {uri: uri, req: this.handler.httpRequest});
        return e.next();
    }
}, EventEmitter.prototype);

livelyDAVPlugin.onNew = function(callback) {
    return {
        "new": function(handler) {
            var plugin = livelyDAVPlugin.new(handler);
            callback(plugin);
            return plugin;
        }
    }
}
