function runMotionWorker(folder)
% One long-lived MATLAB process, private local JSON inbox. Never per sample.
fid=fopen(fullfile(folder,'ready'),'w'); fprintf(fid,'ready'); fclose(fid);
while isfolder(folder) && ~isfile(fullfile(folder,'stop'))
    heartbeat=dir(fullfile(folder,'heartbeat'));
    if isempty(heartbeat) || (now-heartbeat.datenum)*86400>30, break; end
    jobs=dir(fullfile(folder,'*.request.json'));
    for i=1:numel(jobs)
        input=fullfile(folder,jobs(i).name);
        output=strrep(input,'.request.json','.response.json');
        try
            result=analyzeSessionJson(fileread(input));
        catch
            result='{"error":"Invalid motion session"}';
        end
        fid=fopen([output '.tmp'],'w');
        if fid~=-1
            fprintf(fid,'%s',result); fclose(fid);
            movefile([output '.tmp'],output,'f');
        end
        if isfile(input), delete(input); end
    end
    pause(0.05);
end
end
