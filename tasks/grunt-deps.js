"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var typescript_1 = __importDefault(require("typescript"));
var path_1 = __importDefault(require("path"));
var fs_1 = __importDefault(require("fs"));
var graphs_1 = __importDefault(require("graphs"));
module.exports = function (grunt) {
    grunt.registerTask('argos-deps', function () {
        var config = grunt.config.get('argos-deps');
        if (config.cwd) {
            grunt.file.setBase(config.cwd);
        }
        var files = grunt.file.expand(config.files);
        var graph = new graphs_1.default();
        var nodes = {};
        // Resolves import modules into a relative file path
        function resolvePath(module, sourceFile, ext) {
            if (ext === void 0) { ext = '.js'; }
            // TODO: Better fallback mechanism
            // Module could be importing something relative like './Component' - This could be a js, jsx, ts, tsx, file.
            var fallbackExt = '.js';
            var config = grunt.config.get('argos-deps');
            var results;
            // Relative modules start with a period
            if (module.startsWith('.')) {
                var sourceDir = path_1.default.dirname(sourceFile);
                results = path_1.default.join(sourceDir, module) + ext;
                if (fs_1.default.existsSync(results)) {
                    return results;
                }
                else {
                    return path_1.default.join(sourceDir, module) + fallbackExt;
                }
            }
            else {
                var parts = module.split('/');
                var moduleName = parts.shift();
                var config = config.modules.filter(function (m) {
                    return m.name === moduleName;
                })[0];
                if (config && config.location) {
                    var relativeModule = parts.join(path_1.default.sep);
                    results = path_1.default.join(config.location, relativeModule) + ext;
                    if (fs_1.default.existsSync(results)) {
                        return results;
                    }
                    else {
                        return path_1.default.join(config.location, relativeModule) + fallbackExt;
                    }
                }
            }
        }
        // Add nodes to the graph where f is the file path.
        function add(f) {
            if (f === null || typeof f === 'undefined') {
                return null;
            }
            if (nodes[f]) {
                return nodes[f];
            }
            nodes[f] = {
                name: f
            };
            graph.add(nodes[f]);
            return nodes[f];
        }
        // Khan topological sort (https://en.wikipedia.org/wiki/Topological_sorting#Algorithms)
        function sortGraph(graph) {
            var set = [];
            var sorted = [];
            // start nodes which have no incoming edges
            graph.forEach(function (node) {
                if (graph.to(node)
                    .size === 0) {
                    set.push(node);
                }
            });
            while (set.length > 0) {
                var n = set.shift();
                sorted.push(n);
                var incoming = graph.from(n);
                incoming.forEach(function (m) {
                    graph.unlink(n, m);
                    if (graph.to(m)
                        .size === 0) {
                        set.push(m);
                    }
                });
            }
            // Ensure the graph has no more links
            graph.forEach(function (node) {
                if (graph.from(node)
                    .size > 0 || graph.to(node)
                    .size > 0) {
                    throw new Error('Circular dependencies detected.');
                }
            });
            return sorted;
        }
        // - Iterate our JS(ES6) and Typescript files
        // - parse them using the typescript compiler API to get a list of imports (dependencies)
        // - Add each file to the graph
        // - Resolve the dependencies to a filename and add them to the graph
        // - Link dependency to file.
        files.forEach(function (file) {
            var sourceDir = path_1.default.dirname(file);
            var base = path_1.default.basename(file);
            var ext = path_1.default.extname(file);
            var filepath = path_1.default.join(sourceDir, base); // grunt is not using correct seperator on windows
            var fileNode = add(filepath);
            var contents = grunt.file.read(filepath, {
                encoding: 'utf8'
            });
            try {
                var sourceFile = typescript_1.default.createSourceFile(filepath, contents, typescript_1.default.ScriptTarget.ES5, true, typescript_1.default.ScriptKind.Unknown);
                typescript_1.default.forEachChild(sourceFile, function (node) {
                    if (node.kind !== typescript_1.default.SyntaxKind.ImportDeclaration) {
                        return;
                    }
                    var importNode = node;
                    var importPath = importNode.moduleSpecifier.getText().replace(/\'/gi, '');
                    var p = resolvePath(importPath, filepath, ext);
                    var depNode = add(p);
                    if (depNode) {
                        graph.link(depNode, fileNode);
                    }
                });
            }
            catch (error) {
                grunt.log.writeln('Error in ' + file + ': ' + error);
            }
        });
        // Sort the graph and transform the data so it is template friendly
        var sorted = sortGraph(graph)
            .map(function (node) {
            return {
                folderName: path_1.default.dirname(node.name)
                    .replace(/\\/gi, '/') // force unix path seperator
                    .replace(/\/src/gi, '/src-out'),
                fileName: path_1.default.basename(node.name).replace(/\.ts$/gi, '.js') // TODO: Store the file/module separate from extension in the graph, could be .tsx for example
            };
        });
        // Template processing
        var template = grunt.file.read(config.template, {
            encoding: 'utf8'
        });
        var content = grunt.template.process(template, {
            data: {
                files: sorted
            }
        });
        grunt.file.write(config.output, content, {
            encoding: 'utf8'
        });
    });
};
