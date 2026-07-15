// randomuuid function from node:crypto module
import { randomUUID } from 'node:crypto';

// helper functions for handling http requests and responses
import { getBody, getEnv, jsonResponse } from './_http_helpers.js';
// functions and types related to item library management
import { mergeItemLibrary, type TrendLibraryItem } from './_item_library.js';
// functions for loading and saving data from memory storage
import { loadItemsFromMemory, saveItemsToMemory, saveReportToMemory } from './_memory_store.js';
// main function to run the agent pipeline
import { runAgentPipeline } from './_agent_pipeline.js';
// type definition for pipeline emit events
import type { PipelineEmit } from './_agent_pipeline.js';
// helper functions for generating fallback reports and time formatting
import { generateFallbackReport, utcNow } from './_report_helpers.js';
// function to collect data from various sources
import { collectSources } from './_data_sources.js';
// fallback storage functions for local saving and loading
import { loadItemLibrary, saveItemLibrary, saveReport } from './_fallback_storage.js';
// type definition for the final trend report
import type { TrendReport } from './_pipeline_types.js';

// asynchronously export the main function to handle requests
export async function onRequest(context: any): Promise<Response> {
  // extract body and runid from request context and randomUUID
  const body = getBody(context);
  const runId = context?.run_id || `run_${randomUUID().slice(0, 12)}`;
  // determine trigger type based on _schedule flag or body
  const trigger = body._schedule ? 'schedule' : body.trigger || 'manual';
  // define sources, using the provided array
  const sources = Array.isArray(body.sources) ? body.sources : ['hackernews', 'devto', 'web'];
  // parse limit parameter from the body, defaulting to 30
  const limit = Number(body.limit || 30);
  // record timestamp
  const started = Date.now();
  // extract the abortsignal if present in the request
  const signal = context?.request?.signal as AbortSignal | undefined;

  // create a textencoder to encode strings into byte streams
  const encoder = new TextEncoder();
  // If the server only needs to stream data unidirectionally at a high frequency 
  // (ChatGPT’s word-by-word output), SSE is the preferred choice, 
  // as it is lighter and easier to maintain.
  const stream = new ReadableStream({
    // start method of the readablestream
    async start(controller) {
      // define a helper function to emit events to the stream
      const emit = (event: PipelineEmit) => {
        // try to enqueue the encoded event data
        try {
          // stringify event to json, format as sse, encode and enqueue
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          // catch any errors during enqueue
        } catch { // stream may be closed, ignore error
        }
      };

      // try block for main execution logic
      try {
        // ── check abort before starting ──
        if (signal?.aborted) {
          // emit complete event with fallback report and stopped flag, with spaced brackets
          emit({ stage: 'complete', status: 'done', report: generateFallbackReport([], runId, trigger), stopped: true });
          // exit function early
          return;
        }

        // ── fetch & merge ──
        // emit event indicating fetch stage has started
        emit({ stage: 'fetch', status: 'running' });
        // extract sandbox environment from context, default to null
        const sandbox = context?.sandbox ?? null;
        // log sandbox status and sources being used, with spaced brackets
        console.log(`[ run ] sandbox available: ${!!sandbox}, sources: ${JSON.stringify(sources)}`);
        // await collection of candidates from sources
        const candidates = await collectSources(sources, limit, sandbox);
        // reduce candidates to count items per source, with spaced brackets
        const sourceCounts = candidates.reduce((acc, i) => { const k = i.source || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
        // log candidate breakdown by source, with spaced brackets
        console.log(`[ run ] candidates by source:`, sourceCounts);

        // try loading existing items from memory, default to empty array on fail, with spaced brackets
        const memoryItems = await loadItemsFromMemory(context).catch(() => []) as TrendLibraryItem[];
        // use memory items if available, otherwise load from fallback library
        const existingItems = memoryItems.length ? memoryItems : await loadItemLibrary<TrendLibraryItem>();
        // merge existing items with new candidates
        const mergeResult = mergeItemLibrary(existingItems, candidates, new Date().toISOString(), limit);

        // calculate source statistics for the generated report items, with spaced brackets
        const reportSourceCounts = mergeResult.reportItems.reduce((acc, i) => { const k = i.source || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
        // log report items breakdown by source, with spaced brackets
        console.log(`[ run ] reportitems by source:`, reportSourceCounts);

        // determine if no new items were found after merging
        const noNewItems = mergeResult.newItems.length === 0;
        // emit fetch completion event with duration and item count
        emit({ stage: 'fetch', status: 'done', duration: +((Date.now() - started) / 1000).toFixed(1), detail: `${candidates.length} items` });
        // phase 1 of progressive content: emit merged candidate set to frontend
        // so it can render a grayed-out preview before curator filters them.
        emit({ type: 'items', phase: 'fetched', items: mergeResult.reportItems });

        // ── 4-agent pipeline (with sse progress) ──
        const { report } = await runAgentPipeline({
          // pass merged report items to pipeline
          items: mergeResult.reportItems,
          // pass existing items as history
          historyItems: existingItems,
          // pass the generated runid
          runId,
          // pass the execution trigger type
          trigger,
          // pass environment variables
          env: getEnv(context),
          // pass flag indicating if there are no new items
          noNewItems,
          // pass the emit function for progress updates
          onProgress: emit,
          // pass the sandbox environment if it exists
          sandbox: sandbox ?? undefined,
          // pass the abort signal
          signal,
        });

        // ── metadata ──
        // calculate and assign total duration of pipeline execution
        report.durationMs = Date.now() - started;
        // assign used sources to the report
        report.sources = sources;
        // assign schedule flag to the report
        report.schedule = body._schedule;
        // assign the count of newly added items
        report.newItemCount = mergeResult.newItemCount;
        // assign the count of reused historical items
        report.reusedItemCount = mergeResult.reusedItemCount;
        // assign flag indicating if there were no new items
        report.noNewItems = noNewItems;
        // use merged report items as fallback if report items are empty
        if (!report.items?.length) report.items = mergeResult.reportItems;

        // ── persist ──
        // attempt to save the generated report to memory
        const savedToMemory = await saveReportToMemory(context, report).catch(() => false);
        // attempt to save merged items to memory
        const savedItemsToMemory = await saveItemsToMemory(context, mergeResult.items).catch(() => false);
        // if saving items to memory fails, save to fallback item library
        if (!savedItemsToMemory) await saveItemLibrary(mergeResult.items);
        // record the storage method used for the report
        report.storage = savedToMemory ? 'memory' : 'file-fallback';
        // if saving report to memory fails, save to fallback storage
        if (!savedToMemory) await saveReport(report);

        // ── final event with complete report ──
        // emit final complete event with the full report
        emit({ stage: 'complete', status: 'done', report });

      } catch (error) {
        // ── user-initiated abort — clean exit, no error report ──
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          // log pipeline abort event, with spaced brackets
          console.log('[ run ] pipeline aborted by user');
          // emit clean complete event with stopped flag
          emit({ stage: 'complete', status: 'done', stopped: true });
          // exit function
          return;
        }

        // extract error message or convert error object to string
        const message = error instanceof Error ? error.message : String(error);
        // emit error event with failure details
        emit({ stage: 'error', status: 'failed', detail: message });

        // generate fallback report to return, with spaced brackets
        const failed = generateFallbackReport([], runId, trigger);
        // set fallback report status to failed
        failed.status = 'failed';
        // set the generation timestamp for the report
        failed.generatedAt = utcNow();
        // calculate duration up to the point of failure
        failed.durationMs = Date.now() - started;
        failed.summary = 'Failed';
        failed.reportMarkdown = `${message}`;
        // store error message in the report object
        failed.error = message;
        // attempt to save failure report to memory
        const savedToMemory = await saveReportToMemory(context, failed).catch(() => false);
        // if memory save fails, save failure report to fallback storage
        if (!savedToMemory) await saveReport(failed);

        // emit complete event containing the failure report
        emit({ stage: 'complete', status: 'failed', report: failed });
      } finally {
        // attempt to close the stream controller
        try { controller.close(); } catch { // stream may already be closed, ignore
        }
      }
    },
  });

  // return a new http response containing the readable stream
  return new Response(stream, {
    // set http status code to 200 ok
    status: 200,
    // set response headers
    headers: {
      // specify content type for server-sent events
      'Content-Type': 'text/event-stream',
      // disable caching for the stream
      'Cache-Control': 'no-cache',
      // keep connection alive for continuous streaming
      'Connection': 'keep-alive',
      // disable nginx buffering
      'X-Accel-Buffering': 'no',
    },
  });
}