// What the useChat tests render: the hook, its provider and a renderer, in
// one bundle so they share one React instance.
export { default as React } from 'react';
export { create, act } from 'react-test-renderer';
export { useChat } from '../src/hooks/useChat';
export { SinasProvider } from '../src/hooks/context';
export { SinasClient } from '../src/client/SinasClient';
