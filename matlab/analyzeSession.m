function result = analyzeSession(t_ms, ax, ay, az, reference, boundaries)
% One completed interaction, not a per-sample call.
% reference: struct with ax/ay/az. Optional boundaries: start_ms, end_ms,
% initial_sample (the HANDLING trigger sample, excluded from sample_count).
% This reproduces App.jsx's L1 deltas and population standard deviation.
if nargin < 6, boundaries = struct(); end
arrays = {t_ms,ax,ay,az}; n = numel(t_ms);
if n < 2 || n > 10000 || ~all(cellfun(@(v) isnumeric(v) && isreal(v) && isvector(v) && numel(v)==n && all(isfinite(v(:))),arrays))
    error('AcuPill:InvalidSession','Expected 2 to 10000 equally sized finite arrays.');
end
t_ms=double(t_ms(:)); xyz=double([ax(:),ay(:),az(:)]);
if ~isstruct(reference) || ~all(isfield(reference,{'ax','ay','az'}))
    error('AcuPill:InvalidVector','Reference vector is required.');
end
startTime=t_ms(1); endTime=t_ms(end);
if isfield(boundaries,'start_ms'), startTime=boundaries.start_ms; end
if isfield(boundaries,'end_ms'), endTime=boundaries.end_ms; end
if ~isnumeric(startTime) || ~isnumeric(endTime) || ~isscalar(startTime) || ~isscalar(endTime) || ...
        ~isfinite(startTime) || ~isfinite(endTime) || startTime<0 || endTime<startTime || any(t_ms<startTime | t_ms>endTime)
    error('AcuPill:InvalidSession','Invalid session time boundaries.');
end
tilt=zeros(n,1); roll=zeros(n,1); pitch=zeros(n,1);
for i=1:n
    [tilt(i),roll(i),pitch(i)]=analyzeBottleMotion(xyz(i,1),xyz(i,2),xyz(i,3),reference.ax,reference.ay,reference.az);
end
initial=xyz(1,:); firstDt=0;
if isfield(boundaries,'initial_sample') && ~isempty(boundaries.initial_sample)
    s=boundaries.initial_sample;
    if ~isstruct(s) || ~all(isfield(s,{'t_ms','ax','ay','az'}))
        error('AcuPill:InvalidSession','Malformed initial sample.');
    end
    vals={s.t_ms,s.ax,s.ay,s.az};
    if ~all(cellfun(@(v) isnumeric(v) && isreal(v) && isscalar(v) && isfinite(v),vals)) || s.t_ms<0
        error('AcuPill:InvalidSession','Invalid initial sample.');
    end
    initial=[s.ax,s.ay,s.az]; firstDt=(t_ms(1)-s.t_ms)/1000;
end
delta=[xyz(1,:)-initial; diff(xyz,1,1)];
motion=sum(abs(delta),2);
dt=[firstDt;diff(t_ms)/1000]; valid=dt>0;
jerk=sqrt(sum(delta(valid,:).^2,2))./dt(valid);
if isempty(jerk), avgJerk=0; peakJerk=0; else, avgJerk=mean(jerk); peakJerk=max(jerk); end
result=struct('duration_ms',endTime-startTime, ...
    'max_tilt_degrees',max(tilt),'average_tilt_degrees',mean(tilt), ...
    'total_motion_score',sum(motion),'average_motion_score',mean(motion), ...
    'peak_motion_score',max(motion),'motion_variability_score',std(motion,1), ...
    'average_jerk',avgJerk,'peak_jerk',peakJerk,'sample_count',n, ...
    'tilt_degrees',tilt','roll_degrees',roll','pitch_degrees',pitch');
if any(~isfinite([result.duration_ms,result.max_tilt_degrees,result.average_tilt_degrees, ...
        result.total_motion_score,result.average_motion_score,result.peak_motion_score, ...
        result.motion_variability_score,result.average_jerk,result.peak_jerk]))
    error('AcuPill:InvalidSession','Nonfinite analysis result.');
end
end
