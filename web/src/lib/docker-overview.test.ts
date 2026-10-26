import { describe, expect, it } from "vitest";
import { dockerOverviewItems } from "./docker";
import { dockerSample } from "../test/app-fixtures";
import type { DockerSnapshot } from "./api";

function fixture(): DockerSnapshot {
 const containers = ["immich_server", "immich_machine_learning", "immich_redis", "immich_postgres", "Plex"]
  .map((name,index)=>({...dockerSample.containers[0],id:String(index),name}));
 return {...dockerSample,containers,folders:[{id:"folder-photos",name:"Immich",containerIds:["0","1","2","3"],iconUrl:"https://example.test/immich.png"}]};
}
describe("FolderView2 Home overview",()=>{
 it("replaces declared members with one folder and preserves the full Docker snapshot",()=>{
  const snapshot=fixture();
  const items=dockerOverviewItems(snapshot);
  expect(items.map(item=>item.name)).toEqual(["Immich","Plex"]);
  expect(items[0]).toMatchObject({id:"folder-photos",folder:true,iconUrl:"https://example.test/immich.png",running:4,total:4});
  expect(snapshot.containers).toHaveLength(5);
  expect(snapshot.folders?.[0].containerIds).toEqual(["0","1","2","3"]);
 });
 it("matches the plugin's JavaScript regex semantics and keeps explicit members too",()=>{
  const snapshot=fixture();
  snapshot.folders![0]={...snapshot.folders![0],containerIds:["4"],matchPattern:"^immich_(?=server|redis)"};
  const items=dockerOverviewItems(snapshot);
  expect(items.find(item=>item.folder)).toMatchObject({running:3,total:3});
  expect(items.filter(item=>!item.folder).map(item=>item.name)).toEqual(["immich_machine_learning","immich_postgres"]);
 });
 it("shows partially running folders and omits fully stopped folders",()=>{
  const snapshot=fixture();
  snapshot.containers[0].state="exited";
  expect(dockerOverviewItems(snapshot)[0]).toMatchObject({name:"Immich",running:3,total:4});
  snapshot.containers.slice(0,4).forEach(container=>container.state="exited");
  expect(dockerOverviewItems(snapshot).map(item=>item.name)).toEqual(["Plex"]);
 });
 it("handles invalid regex, stale references, duplicate folders and overlapping membership without duplicate entries",()=>{
  const snapshot=fixture();
  snapshot.folders![0].matchPattern="[";
  snapshot.folders![0].containerIds.push("missing","0");
  snapshot.folders!.push({...snapshot.folders![0],id:"folder-other",name:"Other",containerIds:["0"]});
  expect(dockerOverviewItems(snapshot).map(item=>item.name)).toEqual(["Immich","Plex"]);
  snapshot.folders=[];
  expect(dockerOverviewItems(snapshot)).toHaveLength(5);
 });
});
