import * as ts from 'typescript';
import path from 'path';
import Graph from 'graphs';

export = function(grunt: any) {
  grunt.registerTask('argos-tsdeps', () => {
    const config = grunt.config.get('argos-tsdeps');
    if (config.cwd) {
      grunt.file.setBase(config.cwd);
    }

    const files = grunt.file.expand(config.files);
    const graph = new Graph();
    const nodes: any = {};

    // Resolves import modules into a relative file path
    function resolvePath(module: string, sourceFile: string, ext = '.js') {
      var config = grunt.config.get('argos-tsdeps');
      // Relative modules start with a period
      if (module.startsWith('.')) {
        var sourceDir = path.dirname(sourceFile);
        return path.join(sourceDir, module) + ext;
      } else {
        var parts = module.split('/');
        var moduleName = parts.shift();
        var config = config.modules.filter(function(m: any) {
          return m.name === moduleName;
        })[0];
        if (config && config.location) {
          var relativeModule = parts.join(path.sep);
          return path.join(config.location, relativeModule) + ext;
        }
      }
    }

    // Add nodes to the graph where f is the file path.
    function add(f: string | undefined) {
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
    function sortGraph(graph: any) {
      var set:any = [];
      var sorted = [];
      // start nodes which have no incoming edges
      graph.forEach(function(node: any) {
        if (graph.to(node)
          .size === 0) {
          set.push(node);
        }
      });

      while (set.length > 0) {
        var n = set.shift();
        sorted.push(n);

        var incoming = graph.from(n);
        incoming.forEach(function(m:any) {
          graph.unlink(n, m);
          if (graph.to(m)
            .size === 0) {
            set.push(m);
          }
        });
      }

      // Ensure the graph has no more links
      graph.forEach(function(node:any) {
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
    files.forEach(function(file: string) {
      var sourceDir = path.dirname(file);
      var base = path.basename(file);
      const ext = path.extname(file);
      var filepath = path.join(sourceDir, base); // grunt is not using correct seperator on windows
      var fileNode = add(filepath);
      var contents = grunt.file.read(filepath, {
        encoding: 'utf8'
      });
      try {
        const sourceFile = ts.createSourceFile(filepath, contents, ts.ScriptTarget.ES5, true, ts.ScriptKind.Unknown);
        ts.forEachChild(sourceFile, (node: ts.Node) => {
          if (node.kind !== ts.SyntaxKind.ImportDeclaration) {
            return;
          }

          const importNode = node as ts.ImportDeclaration;
          const importPath = importNode.moduleSpecifier.getText().replace(/\'/gi, '');
          const p = resolvePath(importPath, filepath, ext);
          const depNode = add(p);
          if (depNode) {
            graph.link(depNode, fileNode);
          }
        });
      } catch (error) {
        grunt.log.writeln('Error in ' + file + ': ' + error);
      }
    });

    // Sort the graph and transform the data so it is template friendly
    var sorted = sortGraph(graph)
      .map(function(node) {
        return {
          folderName: path.dirname(node.name)
            .replace(/\\/gi, '/') // force unix path seperator
            .replace(/\/src/gi, '/src-out'), // replace src with src-out since our dependencies were scanned in ES6
          fileName: path.basename(node.name)
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
}