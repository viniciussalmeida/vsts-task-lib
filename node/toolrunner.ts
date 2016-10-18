

import Q = require('q');
import os = require('os');
import events = require('events');
import child = require('child_process');
import stream = require('stream');
import tcm = require('./taskcommand');

/**
 * Interface for exec options
 * 
 * @param     cwd        optional working directory.  defaults to current 
 * @param     env        optional envvar dictionary.  defaults to current processes env
 * @param     silent     optional.  defaults to false
 * @param     failOnStdErr     optional.  whether to fail if output to stderr.  defaults to false
 * @param     ignoreReturnCode     optional.  defaults to failing on non zero.  ignore will not fail leaving it up to the caller
 * @param     windowsVerbatimArguments     optional.  whether to skip quoting/escaping arguments if needed.  defaults to false.
 */
export interface IExecOptions {
    cwd: string;
    env: { [key: string]: string };
    silent: boolean;
    failOnStdErr: boolean;
    ignoreReturnCode: boolean;
    outStream: stream.Writable;
    errStream: stream.Writable;
    windowsVerbatimArguments: boolean;
};

/**
 * Interface for exec results returned from synchronous exec functions
 * 
 * @param     stdout      standard output
 * @param     stderr      error output
 * @param     code        return code
 * @param     error       Error on failure
 */
export interface IExecResult {
    stdout: string;
    stderr: string;
    code: number;
    error: Error;
}

export class ToolRunner extends events.EventEmitter {
    constructor(toolPath) {
        super();

        if (!toolPath) {
            throw new Error('Parameter \'toolPath\' cannot be null or empty.');
        }

        this.toolPath = toolPath;
        this.args = [];
        this.silent = false;
        this._debug('toolRunner toolPath: ' + toolPath);
    }

    public toolPath: string;
    public args: string[];
    public silent: boolean;
    private pipeOutputToTool: ToolRunner;

    private _debug(message) {
        if (!this.silent) {
            this.emit('debug', message);
        }
    }

    private _argStringToArray(argString: string): string[] {
        var args = [];

        var inQuotes = false;
        var escaped =false;
        var arg = '';

        var append = function(c) {
            // we only escape double quotes.
            if (escaped && c !== '"') {
                arg += '\\';
            }

            arg += c;
            escaped = false;
        }

        for (var i=0; i < argString.length; i++) {
            var c = argString.charAt(i);

            if (c === '"') {
                if (!escaped) {
                    inQuotes = !inQuotes;
                }
                else {
                    append(c);
                }
                continue;
            }
            
            if (c === "\\" && inQuotes) {
                escaped = true;
                continue;
            }

            if (c === ' ' && !inQuotes) {
                if (arg.length > 0) {
                    args.push(arg);
                    arg = '';
                }
                continue;
            }

            append(c);
        }

        if (arg.length > 0) {
            args.push(arg.trim());
        }

        return args;
    }

    private _getCommandString(options: IExecOptions): string {
        ''
    }

    private _getToolPath(options: IExecOptions): string {
        if (process.platform == 'win32') {
             if (this._isCmdFile()) {
                 return process.env['COMSPEC'] || 'cmd.exe';
             }
        }

        return this.toolPath;
    }

    private _getArgs(options: IExecOptions): string[] {
        if (process.platform == 'win32') {
            if (this._isCmdFile()) {
                let argline: string = `/D /S /C "${this._windowsQuoteCmdArg(this.toolPath)}`;
                for (let i = 0 ; i < this.args.length ; i++) {
                    argline += ' ';
                    argline += options.windowsVerbatimArguments ? this.args[i] : this._windowsQuoteCmdArg(this.args[i]);
                }

                argline += '"';
                return [ argline ];
            }

            if (options.windowsVerbatimArguments) {
                let args = this.args.slice(0); // copy the array

                // Override slice to prevent Node from creating a copy of the arg array.
                // We need Node to use the "unshift" override below.
                args.slice = function () {
                    if (arguments.length != 1 || arguments[0] != 0) {
                        throw new Error('Unexpected arguments passed to args.slice when windowsVerbatimArguments flag is set.');
                    }

                    return args;
                };

                // Override unshift.
                //
                // When using the windowsVerbatimArguments option, Node does not quote the tool path when building
                // the cmdline parameter for the win32 function CreateProcess(). An unquoted space in the tool path
                // causes problems for tools when attempting to parse their own command line args. Tools typically
                // assume their arguments begin after arg 0.
                //
                // By hijacking unshift, we can quote the tool path when it pushed onto the args array. Node builds
                // the cmdline parameter from the args array.
                //
                // Note, we can't simply pass a quoted tool path to Node for multiple reasons:
                //   1) Node verifies the file exists (calls win32 function GetFileAttributesW) and the check returns
                //      false if the path is quoted.
                //   2) Node passes the tool path as the application parameter to CreateProcess, which expects the
                //      path to be unquoted.
                //
                // Also note, in addition to the tool path being embedded within the cmdline parameter, Node also
                // passes the tool path to CreateProcess via the application parameter (optional parameter). When
                // present, Windows uses the application parameter to determine which file to run, instead of
                // interpreting the file from the cmdline parameter.
                args.unshift = function () {
                    if (arguments.length != 1) {
                        throw new Error('Unexpected arguments passed to args.unshift when windowsVerbatimArguments flag is set.');
                    }

                    return Array.prototype.unshift.call(args, `"${arguments[0]}"`); // quote the file name
                };
                return args;
            }
        }

        return this.args;
    }

    private _getSpawnSyncOptions(options: IExecOptions): child.SpawnSyncOptions {
        let result = { } as child.SpawnSyncOptions;
        result.cwd = options.cwd;
        result.env = options.env;
        result['windowsVerbatimArguments'] = options.windowsVerbatimArguments || this._isCmdFile();
        return result;
    }

    private _isCmdFile(): boolean {
        let upperToolPath: string = this.toolPath.toUpperCase();
        return upperToolPath.endsWith('.CMD') || upperToolPath.endsWith('.BAT');
    }

    private _windowsQuoteCmdArg(arg: string): string {
        // Tool runner wraps child_process.spawn() and needs to apply the same quoting as
        // Node in certain cases where the undocumented spawn option windowsVerbatimArguments
        // is used.
        //
        // Since this function is a port of quote_cmd_arg from Node 4.x (technically, lib UV,
        // see https://github.com/nodejs/node/blob/v4.x/deps/uv/src/win/process.c for details),
        // pasting copyright notice from Node within this function:
        //
        //      Copyright Joyent, Inc. and other Node contributors. All rights reserved.
        //
        //      Permission is hereby granted, free of charge, to any person obtaining a copy
        //      of this software and associated documentation files (the "Software"), to
        //      deal in the Software without restriction, including without limitation the
        //      rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
        //      sell copies of the Software, and to permit persons to whom the Software is
        //      furnished to do so, subject to the following conditions:
        //
        //      The above copyright notice and this permission notice shall be included in
        //      all copies or substantial portions of the Software.
        //
        //      THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
        //      IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
        //      FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
        //      AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
        //      LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
        //      FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
        //      IN THE SOFTWARE.

        if (!arg) {
            // Need double quotation for empty argument
            return '""';
        }

        if (arg.indexOf(' ') < 0 && arg.indexOf(' \t') < 0 && arg.indexOf('"') < 0) {
            // No quotation needed
            return arg;
        }

        if (arg.indexOf('"') < 0 && arg.indexOf('\\') < 0) {
            // No embedded double quotes or backslashes, so I can just wrap
            // quote marks around the whole thing.
            return `"${arg}"`;
        }

        // Expected input/output:
        //   input : hello"world
        //   output: "hello\"world"
        //   input : hello""world
        //   output: "hello\"\"world"
        //   input : hello\world
        //   output: hello\world
        //   input : hello\\world
        //   output: hello\\world
        //   input : hello\"world
        //   output: "hello\\\"world"
        //   input : hello\\"world
        //   output: "hello\\\\\"world"
        //   input : hello world\
        //   output: "hello world\"
        let reverse: string = '"';
        let quote_hit = true;
        for (let i = arg.length ; i > 0 ; i--) { // walk the string in reverse
            reverse += arg[i - 1];
            if (quote_hit && arg[i - 1] == '\\') {
                reverse += '\\';
            }
            else if (arg[i - 1] == '"') {
                quote_hit = true;
                reverse += '\\';
            }
            else {
                quote_hit = false;
            }
        }

        reverse += '"';
        return reverse.split('').reverse().join('');
    }

    /**
     * Add argument
     * Append an argument or an array of arguments 
     * returns ToolRunner for chaining
     * 
     * @param     val        string cmdline or array of strings
     * @returns   ToolRunner
     */
    public arg(val: string | string[]): ToolRunner {
        if (!val) {
            return;
        }

        if (val instanceof Array) {
            this._debug(this.toolPath + ' arg: ' + JSON.stringify(val));
            this.args = this.args.concat(val);
        }
        else if (typeof(val) === 'string') {
            this._debug(this.toolPath + ' arg: ' + val);
            this.args = this.args.concat(val.trim());
        }

        return this;
    }

    /**
     * Parses an argument line into one or more arguments
     * e.g. .line('"arg one" two -z') is equivalent to .arg(['arg one', 'two', '-z'])
     * returns ToolRunner for chaining
     * 
     * @param     val        string argument line
     * @returns   ToolRunner
     */
    public line(val: string): ToolRunner {
        if (!val) {
            return;
        }

        this._debug(this.toolPath + ' arg: ' + val);
        this.args = this.args.concat(this._argStringToArray(val));
        return this;    
    }
    
    /**
     * Add argument(s) if a condition is met
     * Wraps arg().  See arg for details
     * returns ToolRunner for chaining
     *
     * @param     condition     boolean condition
     * @param     val     string cmdline or array of strings
     * @returns   ToolRunner
     */
    public argIf(condition: any, val: any) {
        if (condition) {
            this.arg(val);
        }
        return this;
    }

    /**
     * Pipe output of exec() to another tool
     * @param tool
     * @returns {ToolRunner}
     */
    public pipeExecOutputToTool(tool: ToolRunner) : ToolRunner {
        this.pipeOutputToTool = tool;
        return this;
    }

    /**
     * Exec a tool.
     * Output will be streamed to the live console.
     * Returns promise with return code
     * 
     * @param     tool     path to tool to exec
     * @param     options  optional exec options.  See IExecOptions
     * @returns   number
     */
    public exec(options?: IExecOptions): Q.Promise<number> {
        var defer = Q.defer<number>();

        this._debug('exec tool: ' + this.toolPath);
        this._debug('Arguments:');
        this.args.forEach((arg) => {
            this._debug('   ' + arg);
        });

        var success = true;
        options = options || <IExecOptions>{};

        var ops: IExecOptions = <IExecOptions>{
            cwd: options.cwd || process.cwd(),
            env: options.env || process.env,
            silent: options.silent || false,
            failOnStdErr: options.failOnStdErr || false,
            ignoreReturnCode: options.ignoreReturnCode || false
        };

        ops.outStream = options.outStream || <stream.Writable>process.stdout;
        ops.errStream = options.errStream || <stream.Writable>process.stderr;
        ops['windowsVerbatimArguments'] = options.windowsVerbatimArguments || false;

        var argString = this.args.join(' ') || '';
        var cmdString = this.toolPath;
        if (argString) {
            cmdString += (' ' + argString);
        }

        if (!ops.silent) {
            if(!this.pipeOutputToTool) {
                ops.outStream.write('[command]' + cmdString + os.EOL);
            } else {
                var pipeToolArgString = this.pipeOutputToTool.args.join(' ') || '';
                var pipeToolCmdString = this.pipeOutputToTool.toolPath;
                if(pipeToolArgString) {
                    pipeToolCmdString += (' ' + pipeToolArgString);
                }
                ops.outStream.write('[command]' + cmdString + ' | ' + pipeToolCmdString + os.EOL)
            }
        }

        // TODO: filter process.env
        var cp;
        var toolPath = this.toolPath;

        var toolPathFirst;
        var successFirst = true;
        var returnCodeFirst;

        if(this.pipeOutputToTool) {
            toolPath = this.pipeOutputToTool.toolPath;
            toolPathFirst = this.toolPath;

            // Following node documentation example from this link on how to pipe output of one process to another
            // https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options

            //start the child process for both tools
            var spawnOptionsFirst = { } as child.SpawnOptions;
            spawnOptionsFirst.cwd = ops.cwd;
            spawnOptionsFirst.env = ops.env;
            spawnOptionsFirst['windowsVerbatimArguments'] = ops.windowsVerbatimArguments;
            var cpFirst = child.spawn(toolPathFirst, this.args, spawnOptionsFirst);
            var spawnOptions = { } as child.SpawnOptions;
            spawnOptions.cwd = ops.cwd;
            spawnOptions.env = ops.env;
            spawnOptions['windowsVerbatimArguments'] = ops.windowsVerbatimArguments;
            cp = child.spawn(toolPath, this.pipeOutputToTool.args, spawnOptions);

            //pipe stdout of first tool to stdin of second tool
            cpFirst.stdout.on('data', (data: Buffer) => {
                try {
                    cp.stdin.write(data);
                } catch (err) {
                    this._debug('Failed to pipe output of ' + toolPathFirst + ' to ' + toolPath);
                    this._debug(toolPath + ' might have exited due to errors prematurely. Verify the arguments passed are valid.');
                }
            });
            cpFirst.stderr.on('data', (data: Buffer) => {
                successFirst = !ops.failOnStdErr;
                if (!ops.silent) {
                    var s = ops.failOnStdErr ? ops.errStream : ops.outStream;
                    s.write(data);
                }
            });
            cpFirst.on('error', (err) => {
                cp.stdin.end();
                defer.reject(new Error(toolPathFirst + ' failed. ' + err.message));
            });
            cpFirst.on('close', (code, signal) => {
                if (code != 0 && !ops.ignoreReturnCode) {
                    successFirst = false;
                    returnCodeFirst = code;
                }
                this._debug('success of first tool:' + successFirst);
                cp.stdin.end();
            });

        } else {
            var spawnOptions = { } as child.SpawnOptions;
            spawnOptions.cwd = ops.cwd;
            spawnOptions.env = ops.env;
            spawnOptions['windowsVerbatimArguments'] = ops.windowsVerbatimArguments;
            cp = child.spawn(toolPath, this.args, spawnOptions);
        }

        var processLineBuffer = (data: Buffer, strBuffer: string, onLine:(line: string) => void): void => {
            try {
                var s = strBuffer + data.toString();
                var n = s.indexOf(os.EOL);

                while(n > -1) {
                    var line = s.substring(0, n);
                    onLine(line);

                    // the rest of the string ...
                    s = s.substring(n + os.EOL.length);
                    n = s.indexOf(os.EOL);
                }

                strBuffer = s;                
            }
            catch (err) {
                // streaming lines to console is best effort.  Don't fail a build.
                this._debug('error processing line');
            }

        }

        var stdbuffer: string = '';
        cp.stdout.on('data', (data: Buffer) => {
            this.emit('stdout', data);

            if (!ops.silent) {
                ops.outStream.write(data);    
            }

            processLineBuffer(data, stdbuffer, (line: string) => {
                this.emit('stdline', line);    
            });
        });

        var errbuffer: string = '';
        cp.stderr.on('data', (data: Buffer) => {
            this.emit('stderr', data);

            success = !ops.failOnStdErr;
            if (!ops.silent) {
                var s = ops.failOnStdErr ? ops.errStream : ops.outStream;
                s.write(data);
            }

            processLineBuffer(data, errbuffer, (line: string) => {
                this.emit('errline', line);    
            });            
        });

        cp.on('error', (err) => {
            defer.reject(new Error(toolPath + ' failed. ' + err.message));
        });

        cp.on('close', (code, signal) => {
            this._debug('rc:' + code);

            if (stdbuffer.length > 0) {
                this.emit('stdline', stdbuffer);
            }
            
            if (errbuffer.length > 0) {
                this.emit('errline', errbuffer);
            }

            if (code != 0 && !ops.ignoreReturnCode) {
                success = false;
            }

            this._debug('success:' + success);
            if(!successFirst) { //in the case output is piped to another tool, check exit code of both tools
                defer.reject(new Error(toolPathFirst + ' failed with return code: ' + returnCodeFirst));
            } else if (!success) {
                defer.reject(new Error(toolPath + ' failed with return code: ' + code));
            }
            else {
                defer.resolve(code);
            }
        });

        return <Q.Promise<number>>defer.promise;
    }

    /**
     * Exec a tool synchronously. 
     * Output will be *not* be streamed to the live console.  It will be returned after execution is complete.
     * Appropriate for short running tools 
     * Returns IExecResult with output and return code
     * 
     * @param     tool     path to tool to exec
     * @param     options  optionalexec options.  See IExecOptions
     * @returns   IExecResult
     */
    public execSync(options?: IExecOptions): IExecResult {
        var defer = Q.defer();

        this._debug('exec tool: ' + this.toolPath);
        this._debug('Arguments:');
        this.args.forEach((arg) => {
            this._debug('   ' + arg);
        });

        var success = true;
        options = options || <IExecOptions>{};

        var ops: IExecOptions = <IExecOptions>{
            cwd: options.cwd || process.cwd(),
            env: options.env || process.env,
            silent: options.silent || false,
            failOnStdErr: options.failOnStdErr || false,
            ignoreReturnCode: options.ignoreReturnCode || false
        };

        ops.outStream = options.outStream || <stream.Writable>process.stdout;
        ops.errStream = options.errStream || <stream.Writable>process.stderr;
        ops['windowsVerbatimArguments'] = options.windowsVerbatimArguments || false;

        var argString = this.args.join(' ') || '';
        var cmdString = this.toolPath;
        if (argString) {
            cmdString += (' ' + argString);
        }

        if (!ops.silent) {
            ops.outStream.write('[command]' + cmdString + os.EOL);    
        }

        var r = child.spawnSync(this._getToolPath(options), this._getArgs(options), this._getSpawnSyncOptions(ops));

        if (r.stdout && r.stdout.length > 0) {
            ops.outStream.write(r.stdout);
        }

        if (r.stderr && r.stderr.length > 0) {
            ops.errStream.write(r.stderr);
        }

        var res:IExecResult = <IExecResult>{ code: r.status, error: r.error };
        res.stdout = (r.stdout) ? r.stdout.toString() : null;
        res.stderr = (r.stderr) ? r.stderr.toString() : null;
        return res;
    }
}