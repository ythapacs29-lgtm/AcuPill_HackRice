function [tiltAngle, roll, pitch] = analyzeBottleMotion(ax, ay, az, refAx, refAy, refAz)
% Accelerometer-derived orientation, NOT absolute spatial position.
% Acceleration during movement affects these gravity-based estimates.
values = {ax,ay,az,refAx,refAy,refAz};
if ~all(cellfun(@(v) isnumeric(v) && isreal(v) && isscalar(v) && isfinite(v), values))
    error('AcuPill:InvalidVector','Expected six finite numeric scalars.');
end
current = double([ax,ay,az]); reference = double([refAx,refAy,refAz]);
a = sqrt(sum(current.^2)); b = sqrt(sum(reference.^2));
if a == 0 || b == 0 || ~isfinite(a*b)
    error('AcuPill:InvalidVector','Zero or invalid acceleration/reference vector.');
end
cosTheta = dot(current,reference)/(a*b);
cosTheta = max(-1,min(1,cosTheta));
tiltAngle = acosd(cosTheta);
roll = atan2d(ay,az);
pitch = atan2d(-ax,sqrt(ay^2+az^2));
end
