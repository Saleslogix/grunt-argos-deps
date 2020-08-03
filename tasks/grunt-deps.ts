import ts from 'typescript';
import path from 'path';
import fs from 'fs';
import Graph from 'graphs';

interface GraphNode {
  name: string;
}

interface TaskConfig {
  files: string | string[],
  cwd: string,
  output: string,
  template: string,
  modules: ModuleConfig[]
}

interface ModuleConfig {
  name: string;
  location: string;
}

interface ModuleConfigs {
  [key: string]: ModuleConfig
}

const moduleFileExtensions = ['.js', '.jsx', '.ts', '.tsx'];
function resolveModulePath(modulePath: string) {
  return moduleFileExtensions.map((ext) => {
    return `${modulePath}${ext}`;
  }).filter((modulePathWithExt) => {
    return fs.existsSync(modulePathWithExt);
  })[0]; // TODO: Should probably error here if multiple are resolved..
}

function resolveRelativeModule(module: string, sourceFile: string): string {
  const sourceDir = path.dirname(sourceFile);
  return resolveModulePath(path.join(sourceDir, module));
}

function resolveAbsoluteModule(module: string, moduleConfigs: ModuleConfigs): string | null {
  const parts = module.split('/');
  const absModule = parts.join(path.sep);
  const moduleName = parts.shift() || '';
  const moduleConfig = moduleConfigs[moduleName];
  if (moduleConfig && moduleConfig.location) {
    return resolveModulePath(path.join(moduleConfig.location, absModule));
  }
  
  return null;
}

// Khan topological sort (https://en.wikipedia.org/wiki/Topological_sorting#Algorithms)
function sortGraph(graph: Graph<GraphNode>) {
  const set: GraphNode[] = [];
  const sorted: GraphNode[] = [];

  // start nodes which have no incoming edges
  graph.forEach(function(node: any) {
    if (graph.to(node)
      .size === 0) {
      set.push(node);
    }
  });

  while (set.length > 0) {
    const n = set.shift();
    if (!n) {
      break;
    }

    sorted.push(n);

    const incoming = graph.from(n);
    incoming.forEach(function(m:any) {
      graph.unlink(n, m);
      if (graph.to(m)
        .size === 0) {
        set.push(m);
      }
    });
  }

  // Ensure the graph has no more links
  graph.forEach(function(node) {
    if (graph.from(node)
      .size > 0 || graph.to(node)
      .size > 0) {
      throw new Error('Circular dependencies detected.');
    }
  });

  return sorted;
}

export = function(grunt: any) {
  grunt.registerTask('argos-deps', () => {
    const config: TaskConfig = grunt.config.get('argos-deps');
    if (config.cwd) {
      grunt.file.setBase(config.cwd);
    }

    const files = grunt.file.expand(config.files);
    const graph = new Graph<GraphNode>();
    const moduleConfigs: ModuleConfigs = {};
    config.modules.forEach((moduleConfig: ModuleConfig) => {
      moduleConfigs[moduleConfig.name] = moduleConfig;
    });

    // Resolves import modules into a relative file path
    function resolvePath(module: string, sourceFile: string) {
      // Relative modules start with a period
      let modulePath = null;
      if (module.startsWith('.')) {
        modulePath = resolveRelativeModule(module, sourceFile);
      } else {
        modulePath = resolveAbsoluteModule(module, moduleConfigs);
      }

      return modulePath;
    }

    const _nodeCache: { [key: string]: GraphNode } = {};

    // Add nodes to the graph where f is the file path.
    function add(f: string): GraphNode {
      if (_nodeCache[f]) {
        return _nodeCache[f];
      }

      const node = { 
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
    files.forEach(function(file: string) {
      var sourceDir = path.dirname(file);
      var base = path.basename(file);
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
          const importPath  = importNode.moduleSpecifier.getText().replace(/\'/gi, '');
          const resolvedImportPath = resolvePath(importPath, filepath);
          if (resolvedImportPath) {
            const depNode = add(resolvedImportPath);
            graph.link(depNode, fileNode);
          }
          
        });
      } catch (error) {
        grunt.log.writeln('Error in ' + file + ': ' + error);
      }
    });

    // Sort the graph and transform the data so it is template friendly
    const sorted = sortGraph(graph)
      .map(function(node) {
        return {
          folderName: path.dirname(node.name)
            .replace(/\\/gi, '/') // force unix path seperator
            .replace(/\/src/gi, '/src-out'), // replace src with src-out since our dependencies were scanned in ES6
          fileName: path.basename(node.name).replace(/\.(ts|tsx|jsx)$/gi, '.js')
        };
      });

    // Template processing
    const template = grunt.file.read(config.template, {
      encoding: 'utf8'
    });
    const content = grunt.template.process(template, {
      data: {
        files: sorted
      }
    });
    grunt.file.write(config.output, content, {
      encoding: 'utf8'
    });
  });
}