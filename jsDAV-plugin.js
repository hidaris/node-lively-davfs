"use strict";

function log(/*arguments*/) {
    process.stdout.write('livelyDAV: ');
    return console.log.apply(console, arguments);
}

var EventEmitter = require('events').EventEmitter;

var jsDAVPlugin = require("jsdav/lib/DAV/plugin");
// var jsDAV_Property_GetLastModified = require("./../property/getLastModified");
// var jsDAV_Property_ResourceType = require("./../property/resourceType");

// var Fs = require("fs");
// var Async = require("asyncjs");
// var Exc = require("./../../shared/exceptions");
// var Util = require("./../../shared/util");
// var Xml = require("./../../shared/xml");

var livelyDAVPlugin = module.exports = jsDAVPlugin.extend({
    name: "livelydav",
    
    initialize: function(handler) {
        this.handler = handler;
        // this.handler.addEventListener("beforeMethod", this.beforeMethod.bind(this));
        handler.addEventListener("beforeCreateFile", this.beforeCreateFile.bind(this));
        handler.addEventListener("beforeWriteContent", this.beforeWriteContent.bind(this));
        // handler.addEventListener("afterWriteContent", this.afterWriteContent.bind(this));
        // handler.addEventListener("beforeMethod", this.beforeMethod.bind(this));
    },

    beforeMethod: function(e, method) {
        log('beforeMethod:', method);
        return e.next();
    },
    afterWriteContent: function(e, uri) {
        log('after content write of ', uri);
        // debugger;
        // e.next(uri);
    },
    beforeWriteContent: function(e, uri, node) {
        this.emit('fileChanged', {uri: uri, req: this.handler.request});
        return e.next();

        // var self = this;
        // this.handler.getRequestBody("utf8", null, false, function(err, data) {
        //     if (err)
        //         return e.next(err);

        //     try {
        //         self.validateVCard(data);
        //     }
        //     catch (ex) {
        //         return e.next(ex);
        //     }

        //     e.next();
        // });
    },

    beforeCreateFile: function(e, uri, data, encoding, node) {
        this.emit('fileCreated', {uri: uri});
        return e.next();
        // var tempPath = this.isTempFile(uri);
        // if (!tempPath)
        //     return e.next();

        // var enc = "utf8";
        // if (!data || data.length === 0) { //new node version will support writing empty files?
        //     data = new Buffer(0);
        //     enc  = "binary";
        // }
        // Fs.writeFile(tempPath, data, enc, function(err) {
        //     if (err)
        //         return e.next(err);
        //     //@todo set response header: {"X-jsDav-Temp": "true"}
        //     e.stop();
        // });
    },

    // /**
    //  * This method handles the PUT method.
    //  *
    //  * @param {String} tempLocation
    //  * @return bool
    //  */
    // httpPut: function(e, tempLocation) {
    //     var self = this;
    //     Fs.exists(tempLocation, function(exists) {
    //         if (exists && self.handler.httpRequest.headers["if-none-match"]) {
    //             return e.next(new Exc.PreconditionFailed(
    //                 "The resource already exists, and an If-None-Match header was supplied")
    //             );
    //         }

    //         self.handler.getRequestBody("binary", null, false, function(err, body, cleanup) {
    //             if (err)
    //                 return e.next(err);
    //             Fs.writeFile(tempLocation, body, "binary", function(err) {
    //                 if (cleanup)
    //                     cleanup();
    //                 if (err)
    //                     return e.next(err);
    //                 var res = self.handler.httpResponse;
    //                 res.writeHead(!exists ? 201 : 200, {"X-jsDAV-Temp": "true"});
    //                 res.end();
    //                 e.stop();
    //             });
    //         });
    //     });
    // },

    // /**
    //  * This method handles the DELETE method.
    //  *
    //  * If the file didn't exist, it will return false, which will make the
    //  * standard HTTP DELETE handler kick in.
    //  *
    //  * @param {String} tempLocation
    //  * @return bool
    //  */
    // httpDelete: function(e, tempLocation) {
    //     var self = this;
    //     Fs.exists(tempLocation, function(exists) {
    //         if (!exists)
    //             return e.next();
    //         Fs.unlink(tempLocation, function(err) {
    //             if (err)
    //                 return e.next(err);
    //             var res = self.handler.httpResponse;
    //             res.writeHead(204, {"X-jsDAV-Temp": "true"});
    //             res.end();
    //             e.stop();
    //         });
    //     });
    // },

    // /**
    //  * This method handles the PROPFIND method.
    //  *
    //  * It's a very lazy method, it won't bother checking the request body
    //  * for which properties were requested, and just sends back a default
    //  * set of properties.
    //  *
    //  * @param {String} tempLocation
    //  * @return void
    //  */
    // httpPropfind: function(e, tempLocation) {
    //     var self = this;
    //     Fs.stat(tempLocation, function(err, stat) {
    //         if (err || !stat)
    //             return e.next();

    //         self.handler.getRequestBody("utf8", null, false, function(err, data) {
    //             if (err)
    //                 return e.next(err);
    //             self.handler.parsePropfindRequest(data, function(err, requestedProps) {
    //                 if (!Util.empty(err))
    //                     return e.next(err);

    //                 var properties = {};
    //                 properties[tempLocation] = {
    //                     "href" : self.handler.getRequestUri(),
    //                     "200"  : {
    //                         "{DAV:}getlastmodified" : jsDAV_Property_GetLastModified.new(stat.mtime),
    //                         "{DAV:}getcontentlength" : stat.size,
    //                         "{DAV:}resourcetype" : jsDAV_Property_ResourceType.new(null)
    //                     }
    //                 };
    //                 properties[tempLocation]["200"]["{" + Xml.NS_AJAXORG + "}tempFile"] = true;

    //                 var res = self.handler.httpResponse;
    //                 res.writeHead(207, {
    //                     "Content-Type": "application/xml; charset=utf-8",
    //                     "X-jsDAV-Temp": "true"
    //                 });
    //                 res.end(self.handler.generateMultiStatus(properties));
    //                 e.stop();
    //             });
    //         });
    //     });
    // }
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