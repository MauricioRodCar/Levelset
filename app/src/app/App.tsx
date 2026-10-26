import { useState } from 'react';
import { RouterProvider, createBrowserRouter, createHashRouter } from 'react-router-dom';
import { env } from '@/lib/env';
import { Providers } from './Providers';
import { routes } from './routes';

export function App() {
  const [router] = useState(() =>
    env.hashRouter
      ? createHashRouter(routes)
      : createBrowserRouter(routes, {
          basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
        }),
  );
  return (
    <Providers>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Providers>
  );
}
