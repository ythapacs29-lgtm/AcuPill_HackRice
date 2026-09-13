function testMotion()
r=struct('ax',0,'ay',1,'az',0);
[a,~,~]=analyzeBottleMotion(0,1,0,0,1,0); assert(abs(a)<1e-6);
[a,~,~]=analyzeBottleMotion(1,0,0,0,1,0); assert(abs(a-90)<1e-6);
s=analyzeSession([0,100,200],[0,0,0],[1,1,1],[0,0,0],r);
assert(s.total_motion_score==0 && s.average_jerk==0);
s=analyzeSession([0,100,200],[0,1,0],[1,0,1],[0,0,0],r);
assert(s.total_motion_score==4 && s.peak_motion_score==2);
assert(abs(s.motion_variability_score-std([0,2,2],1))<1e-9);
assert(abs(s.peak_jerk-sqrt(2)/0.1)<1e-9);
s=analyzeSession([0,0,200],[0,1,0],[1,0,1],[0,0,0],r);
assert(isfinite(s.average_jerk));
try, analyzeSession([],[],[],[],r); error('Test:ExpectedError','Missing validation');
catch e, assert(strcmp(e.identifier,'AcuPill:InvalidSession')); end
try, analyzeBottleMotion(0,0,0,0,1,0); error('Test:ExpectedError','Missing validation');
catch e, assert(strcmp(e.identifier,'AcuPill:InvalidVector')); end
b=struct('start_ms',0,'end_ms',200,'initial_sample',struct('t_ms',0,'ax',0,'ay',1,'az',0));
s=analyzeSession([100,200],[1,0],[0,1],[0,0],r,b);
assert(s.total_motion_score==4 && s.duration_ms==200 && s.sample_count==2);
fprintf('PASS: MATLAB orientation, stationary/moving, jerk, duplicate dt, invalid input and boundary compatibility\n');
end
