import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createConfig, injected, WagmiProvider } from 'wagmi';
import { loadDeployment } from './config';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <main className="boot">
    <span className="brand-symbol" aria-hidden="true">
      ▥
    </span>
    <h1>Milestone Fund</h1>
    <p role="status">Verifying deployment configuration…</p>
  </main>,
);
loadDeployment()
  .then((runtime) => {
    const config = createConfig({
      chains: [runtime.chain],
      connectors: [injected()],
      transports: { [runtime.chain.id]: runtime.transport },
    });
    root.render(
      <WagmiProvider config={config}>
        <QueryClientProvider client={new QueryClient()}>
          <App runtime={runtime} />
        </QueryClientProvider>
      </WagmiProvider>,
    );
  })
  .catch((error) => {
    root.render(
      <main className="boot">
        <h1>Deployment unavailable</h1>
        <p role="alert">{error.message}</p>
        <button onClick={() => location.reload()}>Reload configuration</button>
      </main>,
    );
  });
