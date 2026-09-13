import test from 'node:test'
import assert from 'node:assert/strict'
import {validEventContext,metrics} from './event-context.mjs'
const id='11111111-1111-4111-8111-111111111111'
const event=()=>({event_id:id,...Object.fromEntries(metrics.map(k=>[k,12])),baseline:{algorithm_version:'mean-v1',event_ids:[2,3,4].map(n=>`00000000-0000-4000-8000-00000000000${n}`),event_count:3,means:Object.fromEntries(metrics.map(k=>[k,10]))},percent_changes:{algorithm_version:'relative-v1',values:Object.fromEntries(metrics.map(k=>[k,20]))},schedule_match:null})
test('null context remains valid',()=>assert.ok(validEventContext({baseline:null,percent_changes:null,schedule_match:null})))
test('populated context valid',()=>assert.ok(validEventContext(event())))
test('rejects incorrect percentages',()=>{const e=event();e.percent_changes.values.duration_ms=30;assert.equal(validEventContext(e),false)})
test('zero reference requires null percent',()=>{const e=event();e.baseline.means.duration_ms=0;assert.equal(validEventContext(e),false);e.percent_changes.values.duration_ms=null;assert.ok(validEventContext(e))})
test('rejects self-inclusion and duplicate references',()=>{const e=event();e.baseline.event_ids[0]=id;assert.equal(validEventContext(e),false);e.baseline.event_ids[0]=e.baseline.event_ids[1];assert.equal(validEventContext(e),false)})
test('rejects mismatched count and missing baseline',()=>{const e=event();e.baseline.event_count=4;assert.equal(validEventContext(e),false);e.baseline=null;assert.equal(validEventContext(e),false)})
test('schedule requires canonical UTC and allowed status',()=>{const e=event();e.schedule_match={schedule_id:id,scheduled_at:'2026-09-13T08:00:00.000Z',status:'recorded',algorithm_version:'window-v1'};assert.ok(validEventContext(e));e.schedule_match.status='taken';assert.equal(validEventContext(e),false)})
