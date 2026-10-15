const publicEndpoint = Symbol('aws-classify.publicEndpoint');

/** Marks a request-class method as anonymously callable when authentication is enabled. */
export function Public(): MethodDecorator {
    return ((target: object | Function, propertyKey: string | symbol | {kind?: string}, descriptor?: PropertyDescriptor) => {
        // TypeScript's legacy decorators receive (target, propertyKey, descriptor).
        // Node 24's TypeScript loader uses the standard decorator form (value, context).
        const value = descriptor?.value ??
            (typeof target === 'function' && typeof propertyKey === 'object' && propertyKey.kind === 'method' ? target : undefined);
        if (typeof value !== 'function') throw new Error('@Public() can decorate methods only');
        Object.defineProperty(value, publicEndpoint, {value: true});
    }) as MethodDecorator;
}

export function isPublicEndpoint(value: unknown): boolean {
    return typeof value === 'function' && (value as {[publicEndpoint]?: boolean})[publicEndpoint] === true;
}
