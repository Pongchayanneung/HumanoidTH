"use client";

import { useEffect } from "react";
import styles from "./GlobalRecovery.module.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Atlas layout failed:", error); }, [error]);

  return (
    <html lang="en">
      <body className={styles.body}>
        <header className={styles.header}>
          <strong>Thailand Humanoid Atlas</strong>
          <nav aria-label="Recovery navigation"><a href="/">Home</a><a href="/search">Search</a></nav>
        </header>
        <main className={styles.content}>
          <h1>The Atlas could not load</h1>
          <p>Try again, or use the recovery links above.</p>
          <button type="button" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
