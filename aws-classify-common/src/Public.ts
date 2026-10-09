const publicEndpoint = Symbol('aws-classify.publicEndpoint');

/** Marks a request-class method as anonymously callable when authentication is enabled. */
export function Public(): MethodDecorator {
    return (_target, _propertyKey, descriptor) => {
        if (!descriptor || typeof descriptor.value !== 'function') throw new Error('@Public() can decorate methods only');
        Object.defineProperty(descriptor.value, publicEndpoint, {value: true});
    };
}

export function isPublicEndpoint(value: unknown): boolean {
    return typeof value === 'function' && (value as {[publicEndpoint]?: boolean})[publicEndpoint] === true;
}
