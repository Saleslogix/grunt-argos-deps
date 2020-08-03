"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var typescript_1 = __importDefault(require("typescript"));
var path_1 = __importDefault(require("path"));
var fs_1 = __importDefault(require("fs"));
var graphs_1 = __importDefault(require("graphs"));
var moduleFileExtensions = ['.js', '.jsx', '.ts', '.tsx'];
function resolveModulePath(modulePath) {
    return moduleFileExtensions.map(function (ext) {
        return "" + modulePath + ext;
    }).filter(function (modulePathWithExt) {
        return fs_1.default.existsSync(modulePathWithExt);
    })[0]; // TODO: Should probably error here if multiple are resolved..
}
function resolveRelativeModule(module, sourceFile) {
    var sourceDir = path_1.default.dirname(sourceFile);
    return resolveModulePath(path_1.default.join(sourceDir, module));
}
function resolveAbsoluteModule(module, moduleConfigs) {
    var parts = module.split('/');
    var absModule = parts.join(path_1.default.sep);
    var moduleName = parts.shift() || '';
    var moduleConfig = moduleConfigs[moduleName];
    if (moduleConfig && moduleConfig.location) {
        return resolveModulePath(path_1.default.join(moduleConfig.location, absModule));
    }
    return null;
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
    var _loop_1 = function () {
        var n = set.shift();
        if (!n) {
            return "break";
        }
        sorted.push(n);
        var incoming = graph.from(n);
        incoming.forEach(function (m) {
            graph.unlink(n, m);
            if (graph.to(m)
                .size === 0) {
                set.push(m);
            }
        });
    };
    while (set.length > 0) {
        var state_1 = _loop_1();
        if (state_1 === "break")
            break;
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
module.exports = function (grunt) {
    grunt.registerTask('argos-deps', function () {
        var config = grunt.config.get('argos-deps');
        if (config.cwd) {
            grunt.file.setBase(config.cwd);
        }
        var files = grunt.file.expand(config.files);
        var graph = new graphs_1.default();
        var moduleConfigs = {};
        config.modules.forEach(function (moduleConfig) {
            moduleConfigs[moduleConfig.name] = moduleConfig;
        });
        // Resolves import modules into a relative file path
        function resolvePath(module, sourceFile) {
            // Relative modules start with a period
            var modulePath = null;
            if (module.startsWith('.')) {
                modulePath = resolveRelativeModule(module, sourceFile);
            }
            else {
                modulePath = resolveAbsoluteModule(module, moduleConfigs);
            }
            return modulePath;
        }
        var _nodeCache = {};
        // Add nodes to the graph where f is the file path.
        function add(f) {
            if (_nodeCache[f]) {
                return _nodeCache[f];
            }
            var node = {
                name: f
            };
            _nodeCache[f] = node;
            graph.add(node);
            return node;
        }
        // - Iterate our JS(ES6) and Typescript files
        // - parse them using the typescript compiler API to get a list of imports (dependencies)
        // - Add each file to the graph
        // - Resolve the dependencies to a filename and add them to the graph
        // - Link dependency to file.
        files.forEach(function (file) {
            var sourceDir = path_1.default.dirname(file);
            var base = path_1.default.basename(file);
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
                    var resolvedImportPath = resolvePath(importPath, filepath);
                    if (resolvedImportPath) {
                        var depNode = add(resolvedImportPath);
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
