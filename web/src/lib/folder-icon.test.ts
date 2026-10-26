import { afterEach, expect, it, vi } from "vitest";
import { getFolderIcon } from "./api";

afterEach(()=>vi.unstubAllGlobals());
it("cancels an oversized folder icon stream without retaining the response",async()=>{
 const canceled=vi.fn();
 const stream=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(400*1024));controller.enqueue(new Uint8Array(200*1024));},
  cancel:canceled,
 });
 const fetcher=vi.fn().mockResolvedValue(new Response(stream,{headers:{"Content-Type":"image/png"}}));
 vi.stubGlobal("fetch",fetcher);
 await expect(getFolderIcon("https://example.test/icon.png",new AbortController().signal)).resolves.toBeNull();
 expect(canceled).toHaveBeenCalledOnce();
});
it("rejects credentials, non-HTTPS URLs and non-image content",async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response("html",{headers:{"Content-Type":"text/html"}}));vi.stubGlobal("fetch",fetcher);
 for(const url of ["http://example.test/icon.png","https://name:pass@example.test/icon.png","javascript:alert(1)"]){
  await expect(getFolderIcon(url,new AbortController().signal)).resolves.toBeNull();
 }
 expect(fetcher).not.toHaveBeenCalled();
 await expect(getFolderIcon("https://example.test/icon.png",new AbortController().signal)).resolves.toBeNull();
 expect(fetcher).toHaveBeenCalledOnce();
});
