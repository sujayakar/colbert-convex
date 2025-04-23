"use client";

import { ConvexLogo } from "@/app/(splash)/GetStarted/ConvexLogo";
import { Code } from "@/components/Code";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  CodeIcon,
  MagicWandIcon,
  PlayIcon,
  StackIcon,
} from "@radix-ui/react-icons";
import { useAction } from "convex/react";
import Link from "next/link";
import { ReactNode, useState } from "react";

type Match = {
  queryStart: number;
  queryEnd: number;
  resultStart: number;
  resultEnd: number;
};

function parseHeatMapKey(key: string): Match {
  const [queryStart, queryEnd, resultStart, resultEnd] = key.split(':').map(Number);
  return { queryStart, queryEnd, resultStart, resultEnd };
}

function getQueryTokens(heatMap: Record<string, number>): { start: number; end: number }[] {
  const tokens = new Set<string>();
  Object.keys(heatMap).forEach(key => {
    const { queryStart, queryEnd } = parseHeatMapKey(key);
    tokens.add(`${queryStart}:${queryEnd}`);
  });
  
  return Array.from(tokens)
    .map(token => {
      const [start, end] = token.split(':').map(Number);
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);
}

function Result({ result, resultIdx, input }: { result: { _id: Id<"texts">, text: string, score: number, heatMap: Record<string, number> }, resultIdx: number, input: string }) {
  const resultsByQueryStart = new Map<number, { resultStart: number, resultEnd: number, queryStart: number, queryEnd: number, score: number }[]>();
  const queryTokens = getQueryTokens(result.heatMap);
  for (const [key, score] of Object.entries(result.heatMap)) {
    const p = parseHeatMapKey(key);
    let m = resultsByQueryStart.get(p.queryStart);
    if (m === undefined) {
      m = [];
      resultsByQueryStart.set(p.queryStart, m);
    }
    m.push({ resultStart: p.resultStart, resultEnd: p.resultEnd, queryStart: p.queryStart, queryEnd: p.queryEnd, score });
  }
  for (const results of Array.from(resultsByQueryStart.values())) {
    // First sort by score descending.
    results.sort((a, b) => b.score - a.score); 

    if (results.length > 3) {
      for (let i = 3; i < results.length; i++) {
        results[i].score = 0;
      }
    }
    // Resort by result position.
    results.sort((a, b) => a.resultStart - b.resultStart);    
  }  

  const resultsByResultStart = new Map<number, { resultStart: number, resultEnd: number, queryStart: number, queryEnd: number, score: number }[]>();
  for (const results of Array.from(resultsByQueryStart.values())) {
    for (const result of results) {
      let m = resultsByResultStart.get(result.resultStart);
      if (m === undefined) {
        m = [];
        resultsByResultStart.set(result.resultStart, m);
      }
      m.push(result);
    }
  }
  return (
    <>
    <div className="mb-r2 text-sm text-muted-foreground">
      Result {resultIdx + 1} • Score: {(result.score).toFixed(4)}
    </div>
    <div className="leading-relaxed">
      {Array.from(resultsByResultStart.entries())
        .map(([resultStart, results], i, arr) => {
          results.sort((a, b) => b.score - a.score);
          const queryStart = results[0].queryStart;          
          const queryTokenIdx = queryTokens.findIndex(t => t.start === queryStart);
          
          // Get the text for this span
          const text = result.text.slice(resultStart, results[0].resultEnd);
          
          // Check if we need a line break
          const prevEnd = i > 0 ? arr[i-1][1][0].resultEnd : 0;
          const textBetween = result.text.slice(prevEnd, resultStart);
          const hasLineBreak = textBetween.includes('\n');
          
          const element = (
            <span 
              key={resultStart} 
              className="rounded-sm transition-colors" 
              style={{                       
                backgroundColor: `hsl(${queryTokenIdx * 360 / 16}, 85%, ${100 - results[0].score * 30}%)`, 
                padding: '0.125rem 0.125rem' 
              }}
            >
              {text}
            </span>
          );

          return (
            <>
              {/* Add any text between matches */}
              {i > 0 && !hasLineBreak && textBetween}
              {/* Add line break if needed */}
              {hasLineBreak && <br />}
              {/* The highlighted span */}
              {element}
            </>
          );
        })}      
    </div>
    </>
  );
}

// {Object.entries(result.heatMap)
//   .map(([key, score]) => ({
//     key,                        
//     ...parseHeatMapKey(key, score)
//   }))
//   .sort((a, b) => a.resultStart - b.resultStart)
//   .reduce((acc, { key, score, resultStart, resultEnd, queryStart, queryEnd }) => {
//     const queryTokenIdx = getQueryTokens(input, result.score, result.heatMap)
//       .findIndex(t => t.start === queryStart && t.end === queryEnd);
    
//     const text = result.text.slice(resultStart, resultEnd);
//     const needsNewLine = acc.length === 0 || 
//       result.text[resultStart - 1] === '\n' ||
//       acc[acc.length - 1].props?.children === '\n';

//     const element = (
//       <span
//         key={key}
//         className="rounded-sm transition-colors"
//         style={{
//           backgroundColor: `hsl(${queryTokenIdx * 360 / 3}, 85%, ${100 - score * 30}%)`,
//           padding: '0.125rem 0',
//         }}
//       >
//         {text}
//       </span>
//     );

//     if (needsNewLine) {
//       acc.push(<div key={`line-${key}`} className="min-h-[1.5em]">{element}</div>);
//     } else {
//       acc.push(element);
//     }

//     return acc;
//   }, [] as JSX.Element[])}

export const GetStarted = () => {  
  const [input, setInput] = useState("");
  const runQuery = useAction(api.text.runQuery);  
  const [results, setResults] = useState<{ _id: Id<"texts">, text: string, score: number, heatMap: Record<string, number> }[] | undefined>();
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const results = await runQuery({ query: input });
    console.log(results);
    setResults(results);
  }

  return (
    <div className="flex grow flex-col">
      <div className="container mb-20 flex grow flex-col justify-center">
        <h1 className="mb-8 mt-16 flex flex-col items-center gap-8 text-center text-6xl font-extrabold leading-none tracking-tight">
          ColBERT search
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4"> 
          <Input type="text" value={input} onChange={(e) => {
            setInput(e.target.value);
            setResults(undefined);
          }} />
          <Button type="submit">Search</Button>
        </form>
        {results !== undefined && (
          <div className="mt-8 space-y-6">
            <h2 className="text-xl font-bold">Results</h2>
            
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Query:</span>
              {getQueryTokens(results[0]?.heatMap ?? {}).map((token, idx) => (
                <span
                  key={idx}
                  className="rounded-md px-2 py-1 text-sm font-medium"
                  style={{ 
                    backgroundColor: `hsl(${idx * 360 / 16}, 85%, 90%)`,
                  }}
                >
                  {input.slice(token.start, token.end)}
                </span>
              ))}
            </div>

            <div className="space-y-4">
              {results.map((result, resultIdx) => (
                <div 
                  key={result._id} 
                  className="rounded-lg border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
                >
                  <Result result={result} resultIdx={resultIdx} input={input} />                  
                </div>
              ))}
            </div>
          </div>
        )}
        {/* <div className="mb-8 text-center text-lg text-muted-foreground">
          Build a realtime full-stack app in no time.
        </div>
        <div className="mb-16 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/product">Get Started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="https://docs.convex.dev/home">Convex docs</Link>
          </Button>
        </div>
        <div className="flex flex-col gap-4 bg-muted/50 p-12 dark:bg-transparent">
          <h2 className="mb-1 text-center text-3xl font-bold md:text-4xl ">
            Next steps
          </h2>
          <div className="mb-1 text-center text-muted-foreground">
            This template is a starting point for building your web application.
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex gap-2">
                  <PlayIcon /> Play with the app
                </CardTitle>
              </CardHeader>
              <CardContent>
                Click on{" "}
                <Link
                  href="/product"
                  className="font-medium underline underline-offset-4 hover:no-underline"
                >
                  Get Started
                </Link>{" "}
                to see the app in action.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex gap-2">
                  <StackIcon /> Inspect your database
                </CardTitle>
              </CardHeader>
              <CardContent>
                The{" "}
                <Link
                  href="https://dashboard.convex.dev/"
                  className="underline underline-offset-4 hover:no-underline"
                  target="_blank"
                >
                  Convex dashboard
                </Link>{" "}
                is already open in another window.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex gap-2">
                  <CodeIcon />
                  Change the backend
                </CardTitle>
              </CardHeader>
              <CardContent>
                Edit <Code>convex/messages.ts</Code> to change the backend
                functionality.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex gap-2">
                  <MagicWandIcon />
                  Change the frontend
                </CardTitle>
              </CardHeader>
              <CardContent>
                Edit <Code>app/page.tsx</Code> to change your frontend.
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <div className="px-20 pb-20">
        <div className="container">
          <h2 className="mb-6 text-center text-2xl font-bold">
            Helpful resources
          </h2>
          <div className="grid gap-6 md:grid-cols-4">
            <Resource title="Convex Docs" href="https://docs.convex.dev/home">
              Read comprehensive documentation for all Convex features.
            </Resource>
            <Resource title="Stack articles" href="https://stack.convex.dev/">
              Learn about best practices, use cases, and more from a growing
              collection of articles, videos, and walkthroughs.
            </Resource>
            <Resource title="Discord" href="https://www.convex.dev/community">
              Join our developer community to ask questions, trade tips &
              tricks, and show off your projects.
            </Resource>
            <Resource title="Search them all" href="https://search.convex.dev/">
              Get unblocked quickly by searching across the docs, Stack, and
              Discord chats.
            </Resource>
          </div>
        </div> */}
      </div> 
    </div>
  );
};

function Resource({
  title,
  children,
  href,
}: {
  title: string;
  children: ReactNode;
  href: string;
}) {
  return (
    <Button
      asChild
      variant="secondary"
      className="flex h-auto flex-col items-start justify-start gap-4 whitespace-normal p-4 font-normal"
    >
      <Link href={href}>
        <div className="text-sm font-bold">{title}</div>
        <div className="text-muted-foreground">{children}</div>
      </Link>
    </Button>
  );
}
