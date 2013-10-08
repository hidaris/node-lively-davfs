"use strict";

function log(/*arguments*/) {
    process.stdout.write('livelyDAV: ');
    return console.log.apply(console, arguments);
}

var EventEmitter = require('events').EventEmitter;
var jsDAVPlugin = require("jsdav/lib/DAV/plugin");

var livelyDAVPlugin = module.exports = jsDAVPlugin.extend({
    name: "livelydav",
    initialize: function(handler) {
        this.handler = handler;
        // handler.addEventListener("beforeMethod", this.beforeMethod.bind(this));
        handler.addEventListener("afterCreateFile", this.afterCreateFile.bind(this));
        handler.addEventListener("afterWriteContent", this.afterWriteContent.bind(this));
        handler.addEventListener("beforeCreateFile", this.beforeCreateFile.bind(this));
        handler.addEventListener("beforeWriteContent", this.beforeWriteContent.bind(this));
        handler.addEventListener("beforeUnbind", this.beforeUnbind.bind(this));
    },
    beforeMethod: function(e, method) {
        log('beforeMethod:', method);
        return e.next();
    },
    beforeWriteContent: function(e, uri, node) {
        this.emit('fileChanged', {uri: uri, req: this.handler.httpRequest});
        return e.next();
    },
    afterWriteContent: function(e, uri) {
        this.emit('afterFileChanged', {uri: uri});
        return e.next();
    },
    beforeCreateFile: function(e, uri, data, encoding, node) {
        this.emit('fileCreated', {uri: uri, req: this.handler.httpRequest});
        return e.next();
    },
    afterCreateFile: function(e, uri) {
        this.emit('afterFileCreated', {uri: uri});
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
