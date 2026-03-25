'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  House,
  MagnifyingGlass,
  Gear,
  ChatCircleDots,
  File,
  FolderSimple,
  PaperPlaneTilt,
  CircleNotch,
} from '@phosphor-icons/react';

const ease = [0.16, 1, 0.3, 1] as const;

// Simulated file tree
const fileTree = [
  { name: 'src/', type: 'folder' as const, indent: 0 },
  { name: 'middleware/', type: 'folder' as const, indent: 1 },
  { name: 'rate-limit.ts', type: 'file' as const, indent: 2, active: true },
  { name: 'auth.ts', type: 'file' as const, indent: 2 },
  { name: 'lib/', type: 'folder' as const, indent: 1 },
  { name: 'embedder.ts', type: 'file' as const, indent: 2 },
  { name: 'store.ts', type: 'file' as const, indent: 2 },
  { name: 'search.ts', type: 'file' as const, indent: 2 },
];

// Simulated code content
const codeLines = [
  { num: 1, content: 'import { Redis } from "ioredis";', dim: true },
  { num: 2, content: '', dim: true },
  { num: 3, content: 'const WINDOW_MS = 60_000;', dim: false },
  { num: 4, content: 'const MAX_REQUESTS = 100;', dim: false },
  { num: 5, content: '', dim: true },
  { num: 6, content: 'export async function rateLimit(', dim: false },
  { num: 7, content: '  clientId: string,', dim: false },
  { num: 8, content: '  redis: Redis', dim: false },
  { num: 9, content: ') {', dim: false },
  { num: 10, content: '  const key = `rl:${clientId}`;', dim: false },
  { num: 11, content: '  const current = await redis.incr(key);', dim: false },
  { num: 12, content: '  if (current === 1) {', dim: false },
  { num: 13, content: '    await redis.pexpire(key, WINDOW_MS);', dim: false },
  { num: 14, content: '  }', dim: false },
  { num: 15, content: '  return current <= MAX_REQUESTS;', dim: false },
  { num: 16, content: '}', dim: false },
];

const userQuery = 'How does the rate limiter work?';

const aiResponseLines = [
  'The rate limiter uses a **sliding window** pattern with Redis:',
  '',
  '1. Each client gets a key `rl:{clientId}`',
  '2. On each request, `INCR` bumps the counter',
  '3. First request sets a 60s TTL via `PEXPIRE`',
  '4. Requests beyond 100 in the window are rejected',
  '',
  'This is in `src/middleware/rate-limit.ts`',
];

function useTypewriter(text: string, speed: number, startDelay: number) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    let index = 0;

    const startTyping = () => {
      timeout = setInterval(() => {
        if (index < text.length) {
          setDisplayed(text.slice(0, index + 1));
          index++;
        } else {
          clearInterval(timeout);
          setDone(true);
        }
      }, speed);
    };

    const delay = setTimeout(startTyping, startDelay);
    return () => {
      clearTimeout(delay);
      clearInterval(timeout);
    };
  }, [text, speed, startDelay]);

  return { displayed, done };
}

function SidebarNav() {
  return (
    <div className="flex h-full w-[140px] shrink-0 flex-col border-r border-border/20 bg-background">
      {/* Logo */}
      <div className="flex items-center gap-1.5 border-b border-border/20 px-3 py-2">
        <div className="size-4 bg-primary" />
        <span className="text-[10px] font-semibold text-foreground">CodeIndexer</span>
      </div>

      {/* Nav items */}
      <div className="flex flex-col gap-0.5 p-1.5">
        {[
          { icon: House, label: 'Dashboard', active: true },
          { icon: MagnifyingGlass, label: 'Search' },
          { icon: ChatCircleDots, label: 'Chat' },
          { icon: Gear, label: 'Settings' },
        ].map((item) => (
          <div
            key={item.label}
            className={`flex items-center gap-1.5 px-2 py-1.5 text-[9px] ${
              item.active
                ? 'tui-corners-sm my-0.5 bg-sidebar-accent text-primary [--tui-corner:var(--primary)]'
                : 'text-muted-foreground'
            }`}
          >
            <item.icon className="size-3" weight={item.active ? 'bold' : 'regular'} />
            {item.label}
          </div>
        ))}
      </div>

      {/* Repo info at bottom */}
      <div className="mt-auto border-t border-border/20 p-2">
        <div className="text-[8px] text-muted-foreground">REPOSITORY</div>
        <div className="mt-0.5 truncate text-[9px] text-foreground">acme/api-server</div>
        <div className="mt-0.5 text-[8px] text-muted-foreground">247 files indexed</div>
      </div>
    </div>
  );
}

function CodePanel() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* File tabs */}
      <div className="flex items-center border-b border-border/20 bg-background">
        <div className="border-b border-primary px-3 py-1.5 text-[9px] text-foreground">
          rate-limit.ts
        </div>
        <div className="px-3 py-1.5 text-[9px] text-muted-foreground">auth.ts</div>
      </div>

      {/* Code + file tree */}
      <div className="flex flex-1">
        {/* File tree */}
        <div className="w-[120px] shrink-0 border-r border-border/20 p-1.5">
          {fileTree.map((item, i) => (
            <div
              key={i}
              className={`flex items-center gap-1 py-0.5 text-[8px] ${
                item.type === 'file' && item.active
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
              style={{ paddingLeft: `${item.indent * 8 + 4}px` }}
            >
              {item.type === 'folder' ? (
                <FolderSimple className="size-2.5" weight="fill" />
              ) : (
                <File className="size-2.5" />
              )}
              {item.name}
            </div>
          ))}
        </div>

        {/* Code view */}
        <div className="flex-1 overflow-hidden p-2">
          {codeLines.map((line) => (
            <div key={line.num} className="flex text-[8px] leading-[14px]">
              <span className="w-5 shrink-0 text-right text-muted-foreground/50">
                {line.num}
              </span>
              <span
                className={`ml-2 ${line.dim ? 'text-muted-foreground/60' : 'text-foreground'}`}
              >
                {line.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatPanel() {
  const { displayed: typedQuery, done: queryDone } = useTypewriter(userQuery, 50, 2000);
  const [streamedLines, setStreamedLines] = useState<string[]>([]);
  const [showThinking, setShowThinking] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!queryDone) return;

    // Show thinking indicator
    setShowThinking(true);
    const thinkTimer = setTimeout(() => {
      setShowThinking(false);
    }, 1200);

    // Stream response lines
    let lineIndex = 0;
    const streamTimer = setTimeout(() => {
      const interval = setInterval(() => {
        if (lineIndex < aiResponseLines.length) {
          setStreamedLines((prev) => [...prev, aiResponseLines[lineIndex]!]);
          lineIndex++;
        } else {
          clearInterval(interval);
        }
      }, 200);

      return () => clearInterval(interval);
    }, 1200);

    return () => {
      clearTimeout(thinkTimer);
      clearTimeout(streamTimer);
    };
  }, [queryDone]);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamedLines, showThinking]);

  return (
    <div className="flex h-full w-[200px] shrink-0 flex-col border-l border-border/20">
      {/* Chat header */}
      <div className="flex items-center gap-1.5 border-b border-border/20 px-3 py-2">
        <ChatCircleDots className="size-3 text-primary" weight="bold" />
        <span className="tui-label !text-[8px]">Chat</span>
      </div>

      {/* Messages */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-2">
          {/* User message */}
          <AnimatePresence>
            {typedQuery && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-0.5"
              >
                <span className="text-[7px] font-semibold text-primary">YOU</span>
                <div className="bg-muted/50 p-1.5 text-[9px] leading-relaxed text-foreground">
                  {typedQuery}
                  {!queryDone && (
                    <span className="ml-0.5 inline-block w-1 animate-pulse bg-primary text-transparent">
                      |
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Thinking indicator */}
          <AnimatePresence>
            {showThinking && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1 text-[8px] text-muted-foreground"
              >
                <CircleNotch className="size-2.5 animate-spin" />
                Thinking...
              </motion.div>
            )}
          </AnimatePresence>

          {/* AI response */}
          {streamedLines.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col gap-0.5"
            >
              <span className="text-[7px] font-semibold text-muted-foreground">CODEINDEXER</span>
              <div className="space-y-0.5 text-[9px] leading-relaxed text-foreground/80">
                {streamedLines.map((line, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, ease }}
                  >
                    {line || '\u00A0'}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border/20 p-2">
        <div className="flex items-center gap-1 border border-border/20 bg-muted/30 px-2 py-1">
          <span className="flex-1 text-[8px] text-muted-foreground">Ask about this code...</span>
          <PaperPlaneTilt className="size-2.5 text-primary" weight="fill" />
        </div>
      </div>
    </div>
  );
}

export function HeroDashboardDemo() {
  return (
    <motion.div
      className="tui-corners-lg mx-auto w-full max-w-4xl overflow-hidden bg-card shadow-2xl"
      initial={false}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease }}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-border/20 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <div className="size-2 bg-destructive/60" />
          <div className="size-2 bg-primary/60" />
          <div className="size-2 bg-muted-foreground/40" />
        </div>
        <span className="text-[9px] text-muted-foreground">CodeIndexer — acme/api-server</span>
        <div className="w-12" />
      </div>

      {/* App layout */}
      <div className="flex h-[280px]">
        <SidebarNav />
        <CodePanel />
        <ChatPanel />
      </div>
    </motion.div>
  );
}
