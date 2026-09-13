function output = analyzeSessionJson(input)
% JSON boundary for a persistent local worker.
% No eval, file paths or executable expressions are accepted from requests.
request=jsondecode(input);
if ~isfield(request,'samples') || ~isstruct(request.samples) || ...
        ~all(isfield(request.samples,{'t_ms','ax','ay','az'})) || ~isfield(request,'reference')
    error('AcuPill:InvalidSession','Expected reference and samples.');
end
s=request.samples;
result=analyzeSession([s.t_ms],[s.ax],[s.ay],[s.az],request.reference,request);
output=jsonencode(result);
end
