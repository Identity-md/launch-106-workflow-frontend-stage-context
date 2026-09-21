import React from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { loadDeployment, network } from "./config";
import { App } from "./App";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <main>
    <h1>Quorum</h1>
    <p>Verifying deployment and ABIs…</p>
  </main>,
);
loadDeployment()
  .then((runtime) => {
    const config = createConfig({
      chains: [runtime.chain],
      connectors: [injected()],
      transports: { [runtime.chain.id]: http(network.rpc) },
    });
    root.render(
      <React.StrictMode>
        <WagmiProvider config={config}>
          <QueryClientProvider client={new QueryClient()}>
            <RainbowKitProvider
              theme={darkTheme({
                accentColor: "#bfe88c",
                accentColorForeground: "#142e2a",
              })}
            >
              <App runtime={runtime} />
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </React.StrictMode>,
    );
  })
  .catch((e) =>
    root.render(
      <main>
        <h1>Unable to load Quorum</h1>
        <p role="alert">{e.message}</p>
        <button onClick={() => location.reload()}>Retry</button>
      </main>,
    ),
  );
