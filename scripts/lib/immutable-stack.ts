export interface Stack<T> {
  readonly items: readonly T[];
}

export function create<T>(items: readonly T[] = []): Stack<T> {
  return { items };
}

export function push<T>(stack: Stack<T>, item: T): Stack<T> {
  return { items: [...stack.items, item] };
}

export function pop<T>(stack: Stack<T>): {
  item: T | undefined;
  stack: Stack<T>;
} {
  if (stack.items.length === 0) {
    return { item: undefined, stack };
  }

  const newItems = stack.items.slice(0, -1);
  const poppedItem = stack.items[stack.items.length - 1];
  return { item: poppedItem, stack: { items: newItems } };
}

export function peek<T>(stack: Stack<T>): T | undefined {
  return stack.items[stack.items.length - 1];
}

export function isEmpty<T>(stack: Stack<T>): boolean {
  return stack.items.length === 0;
}

export function size<T>(stack: Stack<T>): number {
  return stack.items.length;
}
