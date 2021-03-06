// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

/// <reference path="../typings/index.d.ts" />
/// <reference path="../_build/task.d.ts" />

import assert = require('assert');
import path = require('path');
import fs = require('fs');
import shell = require('shelljs');
import * as tl from '../_build/task';
import testutil = require('./testutil');

describe('Test vsts-task-lib', function () {

    before(function (done) {
        try {
            testutil.initialize();
        }
        catch (err) {
            assert.fail('Failed to load task lib: ' + err.message);
        }
        done();
    });

    after(function () {

    });

    it('validate loc string key in lib.json', function (done) {
        this.timeout(1000);

        var jsonPath = path.join(__dirname, '../lib.json');
        var json = require(jsonPath);
        if (json && json.hasOwnProperty('messages')) {
            for (var key in json.messages) {
                assert(key.search(/\W+/gi) < 0, ('messages key: \'' + key + '\' contain non-word characters, only allows [a-zA-Z0-9_].'));
                assert(key.search(/^LIB_/) === 0, ('messages key: \'' + key + '\' should start with \'LIB_\'.'));
                if (typeof (json.messages[key]) === 'object') {
                    assert(false, ('messages key: \'' + key + '\' should have a loc string, not a object.'));
                }
                else if (typeof (json.messages[key]) === 'string') {
                    assert(json.messages[key].toString().length > 0, ('messages key: \'' + key + '\' should have a loc string.'));
                }
            }
        }

        done();
    })
    it('get loc string from loc resources.json', function (done) {
        this.timeout(1000);

        var tempFolder = path.join(testutil.getTestTemp(), 'loc-str-from-loc-res-json');
        shell.mkdir('-p', tempFolder);
        var jsonStr = "{\"messages\": {\"key1\" : \"string for key 1.\", \"key2\" : \"string for key %d.\", \"key3\" : \"string for key %%.\"}}";
        var jsonPath = path.join(tempFolder, 'task.json');
        fs.writeFileSync(jsonPath, jsonStr);

        var tempLocFolder = path.join(tempFolder, 'Strings', 'resources.resjson', 'zh-CN');
        shell.mkdir('-p', tempLocFolder);
        var locJsonStr = "{\"loc.messages.key1\" : \"loc cn-string for key 1.\", \"loc.messages.key2\" : \"loc cn-string for key %d.\", \"loc.messages.key3\" : \"loc cn-string for key %%.\"}";
        var locJsonPath = path.join(tempLocFolder, 'resources.resjson');
        fs.writeFileSync(locJsonPath, locJsonStr);

        process.env['SYSTEM_CULTURE'] = 'ZH-cn'; // Lib should handle casing differences for culture.

        tl.setResourcePath(jsonPath);

        assert.equal(tl.loc('key1'), 'loc cn-string for key 1.', 'string not found for key.');
        assert.equal(tl.loc('key2', 2), 'loc cn-string for key 2.', 'string not found for key.');
        assert.equal(tl.loc('key3'), 'loc cn-string for key %%.', 'string not found for key.');

        done();
    })
    it('fallback to current string if culture resources.resjson not found', function (done) {
        this.timeout(1000);

        var tempFolder = path.join(testutil.getTestTemp(), 'loc-fallback-culture-resjson-not-found');
        shell.mkdir('-p', tempFolder);
        var jsonStr = "{\"messages\": {\"key1\" : \"string for key 1.\", \"key2\" : \"string for key %d.\", \"key3\" : \"string for key %%.\"}}";
        var jsonPath = path.join(tempFolder, 'task.json');
        fs.writeFileSync(jsonPath, jsonStr);

        process.env['SYSTEM_CULTURE'] = 'zh-CN';

        tl.setResourcePath(jsonPath);
        assert.equal(tl.loc('key2', 2), 'string for key 2.', 'en-US fallback string not return for key.');

        done();
    })
    it('fallback to current string if loc string not found in culture resources.resjson', function (done) {
        this.timeout(1000);

        var tempFolder = path.join(testutil.getTestTemp(), 'loc-fallback-culture-string-not-found');
        shell.mkdir('-p', tempFolder);
        var jsonStr = "{\"messages\": {\"key1\" : \"string for key 1.\", \"key2\" : \"string for key %d.\", \"key3\" : \"string for key %%.\"}}";
        var jsonPath = path.join(tempFolder, 'task.json');
        fs.writeFileSync(jsonPath, jsonStr);

        var tempLocFolder = path.join(tempFolder, 'Strings', 'resources.resjson', 'zh-CN');
        shell.mkdir('-p', tempLocFolder);
        var locJsonStr = "{\"loc.messages.key1\" : \"loc cn-string for key 1.\", \"loc.messages.key3\" : \"loc cn-string for key %%.\"}";
        var locJsonPath = path.join(tempLocFolder, 'resources.resjson');
        fs.writeFileSync(locJsonPath, locJsonStr);

        process.env['SYSTEM_CULTURE'] = 'zh-CN';

        tl.setResourcePath(jsonPath);
        assert.equal(tl.loc('key2', 2), 'string for key 2.', 'en-US fallback string not return for key.');

        done();
    })
    it('fallback to en-US if culture not set', function (done) {
        this.timeout(1000);

        var tempFolder = path.join(testutil.getTestTemp(), 'loc-default-to-en-US');
        shell.mkdir('-p', tempFolder);
        var jsonStr = "{\"messages\": {\"key1\" : \"string for key 1.\", \"key2\" : \"string for key %d.\", \"key3\" : \"string for key %%.\"}}";
        var jsonPath = path.join(tempFolder, 'task.json');
        fs.writeFileSync(jsonPath, jsonStr);

        var tempLocFolder = path.join(tempFolder, 'Strings', 'resources.resjson', 'en-US');
        shell.mkdir('-p', tempLocFolder);
        var locJsonStr = "{\"loc.messages.key1\" : \"loc en-string for key 1.\", \"loc.messages.key2\" : \"loc en-string for key %d.\", \"loc.messages.key3\" : \"loc en-string for key %%.\"}";
        var locJsonPath = path.join(tempLocFolder, 'resources.resjson');
        fs.writeFileSync(locJsonPath, locJsonStr);

        process.env['SYSTEM_CULTURE'] = '';

        tl.setResourcePath(jsonPath);
        assert.equal(tl.loc('key2', 2), 'loc en-string for key 2.', 'en-US fallback string not return for key.');

        done();
    })
    it('return key and params if key is not in task.json', function (done) {
        this.timeout(1000);

        var tempFolder = path.join(testutil.getTestTemp(), 'loc-key-not-found-returns-key-plus-args');
        shell.mkdir('-p', tempFolder);
        var jsonStr = "{\"messages\": {\"key1\" : \"string for key 1.\", \"key2\" : \"string for key %d.\"}}";
        var jsonPath = path.join(tempFolder + 'task.json');
        fs.writeFileSync(jsonPath, jsonStr);

        tl.setResourcePath(jsonPath);
        assert.equal(tl.loc('key3', 3), 'key3 3', 'key and params not return for non-exist key.');

        done();
    })
});
