import net from 'node:net';

// Test transport for the trust-authenticated, disposable loopback cluster only.
// Uses PostgreSQL's simple query protocol; it does not emulate SQL or authority.
export const queryLoopbackPostgres = (sql, database = 'fin01_cert_final') => {
  if (!/^fin01_cert[a-z0-9_]*$/.test(database)) throw new Error('FIXTURE_DATABASE_REQUIRED');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host:'127.0.0.1',port:55847 });
    let buffer=Buffer.alloc(0), started=false, error=null, settled=false;
    const rows=[];
    const finish=(failure)=>{
      if(settled)return;settled=true;
      const terminate=Buffer.alloc(5);terminate[0]=88;terminate.writeInt32BE(4,1);
      socket.end(terminate);
      if(failure)reject(failure);else resolve(rows.filter(Boolean).join('\n').trim());
    };
    socket.setTimeout(22000,()=>{socket.destroy();finish(new Error('FIXTURE_QUERY_TIMEOUT'));});
    socket.on('error',finish);
    socket.on('end',()=>{if(!settled)finish(new Error('FIXTURE_CONNECTION_ENDED'));});
    socket.on('connect',()=>{
      const payload=Buffer.from(`user\0postgres\0database\0${database}\0application_name\0fin01-cert\0\0`);
      const message=Buffer.alloc(8+payload.length);message.writeInt32BE(message.length,0);message.writeInt32BE(196608,4);payload.copy(message,8);socket.write(message);
    });
    socket.on('data',(chunk)=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=5){
        const type=String.fromCharCode(buffer[0]),length=buffer.readInt32BE(1);
        if(length<4||length>10000000){finish(new Error('FIXTURE_PROTOCOL_INVALID'));return;}
        if(buffer.length<length+1)return;
        const body=buffer.subarray(5,length+1);buffer=buffer.subarray(length+1);
        if(type==='R'&&body.readInt32BE(0)!==0){finish(new Error('FIXTURE_TRUST_AUTH_REQUIRED'));return;}
        if(type==='E'){
          const fields={};let offset=0;
          while(offset<body.length&&body[offset]){const key=String.fromCharCode(body[offset++]),end=body.indexOf(0,offset);fields[key]=body.toString('utf8',offset,end);offset=end+1;}
          error=Object.assign(new Error(`${fields.M}\n${fields.W||''}`),{code:fields.C});
        }
        if(type==='D'){
          const count=body.readInt16BE(0);let offset=2;const values=[];
          for(let i=0;i<count;i++){const size=body.readInt32BE(offset);offset+=4;values.push(size<0?'':body.toString('utf8',offset,offset+size));if(size>=0)offset+=size;}
          rows.push(values.join('|'));
        }
        if(type==='Z'){
          if(started){finish(error);return;}
          started=true;const payload=Buffer.from(`set statement_timeout='15s';set lock_timeout='5s';${sql}\0`);
          const message=Buffer.alloc(5+payload.length);message[0]=81;message.writeInt32BE(payload.length+4,1);payload.copy(message,5);socket.write(message);
        }
      }
    });
  });
};
