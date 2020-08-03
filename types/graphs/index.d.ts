declare module 'graphs' {
  export = Graph;

  declare class Graph<T> {
    constructor();
    add(node: T): void;
    has(node): boolean;
    from(node: T): Graph<T>;
    to(node: T): Graph<T>;
    link(a: T, b: T): void;
    unlink(a: T, b: T): void;
    forEach(callback: (node: T) => void): void;
    size: number;
  }
}