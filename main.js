'use strict';
//bolio Adapter for ioBroker
//REV 0.0.1
//Update to the last version of the ACTIVE SEND Protokoll 5.16
//Implements Power measurement with IN, OUT, BUS and DMX Ports
//Implements min max tracking of addition reads

const adaptername = "bolio"

const utils = require('@iobroker/adapter-core');
var adapter  = utils.Adapter (adaptername);

var LOG_ALL = false;						//Flag to activate full logging

//DMXFACE CONNECTION values
var IPADR  = "0.0.0.0";						//DMXface IP address
var PORT = 0;								//DMXface port of TCP server ACIVE SEND socket (Configured @ DMXface Setup)
var TIMING = 1000;							//Request timing for addtional added ports and analog inputs
var DMX_CHANNELS_USED = 0;					//DMXchannels in use by ioBroker to prevent getting objects for all 244 channels

//To receive analog values of INports, BUSinports and DMXchannels (optional as converted value by tables stored in DMXface) 
//The required ports have to be specified with a string containing 'INnn, BUSnn,DMXnn' seperated by comma.
//E.g. 'IN1,IN4,BUS1,DMX7' creates objects for the analog / converted values of the listed 4 additional channels
//The listed ports are requested with the specified cycle time one by one.
var EX_REQUEST_LIST = "";  		//Setup list for additional channel requests
var EX_REQUEST_NAMES = [];  	//['VALUE_IN1'],[VALUE_IN2] ...formatted and checked to be created as STATE Objects
var EX_REQUEST_PORTS ="";  		//String "IIIIBBBDDD" each postion I,B,D equvalent to list
var EX_REQUEST_NUMBERS =[];		//[1],[2],[3] ...  Array with Portnumbers 1 to nn as integer 
var EX_PTR = 0;  				//Pointer to the Object requested next by the timed cycle
var EX_MINMAX_TRACKING = false;

//POWER MEASUREMENT
var PW_REQUEST_LIST = "";	//STRING of Portlist to be processed (DMX001(500),IN1(125),BUS1(1000),OUT5(500))  /DMXface Statename (watt)
var PW_REQUEST_NAMES =[];		//STATE OBJECT NAMES extracted out of List
var PW_REQUEST_BOOL =[];		//True when request is bool, false wenn DMX and value is 0-255
var PW_REQUEST_OUTPUT=[];		//OUTPUT OBJECT NAMES 
var PW_REQUEST_RUNTIME=[];		//RUNTIME when the port was on / HOURS
var PW_REQUEST_KW = [];			//Power calculated to Request timebase out of wattage 


// OBJECT ID of TIMED DATA REQUEST
var OBJID_REQUEST; 

// DMXface TCP Connection
var net = require ('net');
var client = new net.Socket();

	// Handler
	client.on ('data',CBclientRECEIVE);
	client.on ('error',CBclientERROR);
	client.on ('close',CBclientCLOSED);
	client.on ('ready',CBclientCONNECT);
var APPLICATIONstopp = false;		//FLAG that shows that a reconnect process is runnig, after an error has occured.

//FLAG, true when connection established and free of error
var IS_ONLINE  = false;

//*************************************  ADAPTER STARTS with ioBroker *******************************************
adapter.on ('ready',function (){
	var i;
//Move the ioBroker Adapter configuration to the container values 
	IPADR = adapter.config.ipaddress;
	PORT = adapter.config.port;
	TIMING = adapter.config.requesttiming; 
	EX_REQUEST_LIST = adapter.config.addchannels;
	LOG_ALL = adapter.config.extlogging;
	DMX_CHANNELS_USED = parseInt(adapter.config.lastdmxchannel);
	PW_REQUEST_LIST = adapter.config.pwrequestlist;
	EX_MINMAX_TRACKING = adapter.config.minmaxtracking;

//LIMIT the number of DMX channels max. 224 usable with ioBroker
	if (DMX_CHANNELS_USED >224) {DMX_CHANNELS_USED = 224};
	if (DMX_CHANNELS_USED <0) {DMX_CHANNELS_USED = 0};
//LIMIT the request timimng	
	if (TIMING <100){TIMING = 100;}
	if (TIMING > 3600000) {TIMING = 3600000;}
	
	adapter.log.info ("bolio" + IPADR + " Port:" + PORT + " DMXchannels:" + DMX_CHANNELS_USED);

//Read and check the user configurable string containig additional ports that will by requested by ioBroker
	if (EX_REQUEST_LIST==null) {EX_REQUEST_LIST = "";}		// maybe NULL @ first start
	EX_REQUEST_LIST = EX_REQUEST_LIST.trim();				//Remove blanks
	if (EX_REQUEST_LIST.length > 0){						//Check for content
		EX_REQUEST_LIST = EX_REQUEST_LIST.toUpperCase();		//Uppercase "IN1,IN3,BUS4,..."
		var BUFF = EX_REQUEST_LIST.split(",");					//Split the content seperated by ","

		for (i=0; i<BUFF.length; i++){							//Check the elements vor valid entries and add to list 
			var BB = BUFF[i].trim();
			switch (BB[0]){										//Check first character and Port number 
				case 'I':		//INPORT valid from 1 to 16
					var PNR = parseInt(BB.substring(2));   // e.g. "IN10" --> Position 2++ has to contain Portnumber
					if (PNR >0 && PNR <16) {					//VALID INPORT NUMBER 1 to 16 (ports with AD Option)
						EX_REQUEST_PORTS += 'I';				//ADD Element to String
						EX_REQUEST_NUMBERS.push (PNR);
						EX_REQUEST_NAMES.push ('VALUE_' + GetIN(PNR));
						if (LOG_ALL) {adapter.log.info ("String entry, create State:" + EX_REQUEST_NAMES[EX_REQUEST_NAMES.length -1])}
					}
					break;
				case 'B':   //BUS Port valid from 1 to 32
					var PNR = parseInt(BB.substring(3));   // e.g. "BUS24" -> Position 3++ has to contain Portnumber
					if (PNR >0 && PNR <33) {					//VALID INPORT NUMBER 1 to 32
						EX_REQUEST_PORTS += 'B';				//ADD Element to list
						EX_REQUEST_NUMBERS.push (PNR);
						EX_REQUEST_NAMES.push ('VALUE_' + GetBUS(PNR));
						if (LOG_ALL) {adapter.log.info ("String entry, create State:" + EX_REQUEST_NAMES[EX_REQUEST_NAMES.length -1])}
					}
					break;
				case 'D':   //DMX valid from 1 to 224
					var PNR = parseInt(BB.substring(3));   // e.g. "DMX221" -> Position 3++ has to contain Portnumber
					if (PNR >0 && PNR <225) {					//VALID DMX NUMBER 1 to 224
						EX_REQUEST_PORTS += 'D';				//ADD Element to list
						EX_REQUEST_NUMBERS.push (PNR);
						EX_REQUEST_NAMES.push ('VALUE_' + GetDMX(PNR));
						if (LOG_ALL) {adapter.log.info ("String entry, create State:" + EX_REQUEST_NAMES[EX_REQUEST_NAMES.length -1])}
					}
					break;
				//REV1.1 Update CHAR BUFFERS valid from DMXface Firmware 5.17
				case 'C':   //CHAR BUFFER REQUEST 1-8
					var PNR = parseInt(BB.substring(4));   // e.g. "CHAR7" -> Position 4++ has to contain CHAR BUFFER NR
					if (PNR >0 && PNR <9) {						//VALID NUMBER 1 to 8
						EX_REQUEST_PORTS += 'C';				//ADD Element to list
						EX_REQUEST_NUMBERS.push (PNR);
						EX_REQUEST_NAMES.push ('VALUE_' +GetCHARBUFFER(PNR));
						if (LOG_ALL) {adapter.log.info ("String entry, create State:" + EX_REQUEST_NAMES[EX_REQUEST_NAMES.length -1])}
					}
					break;
				default:
					break;
			}
		}
	}
						
//Read and check the user configurable Power/RUNTIME string containig additional ports that will measured
	if (PW_REQUEST_LIST==null) {PW_REQUEST_LIST = "";}		// maybe NULL @ first start
	PW_REQUEST_LIST = PW_REQUEST_LIST.trim();				//Remove blanks
	if (PW_REQUEST_LIST.length > 0){						//Check for content
		PW_REQUEST_LIST = PW_REQUEST_LIST.toUpperCase();		//Uppercase "IN1,IN3,BUS4,..."
		var BUFF = PW_REQUEST_LIST.split(",");					//Split the content seperated by ","
		for (i=0; i<BUFF.length; i++){							//Check the elements vor valid entries and add to list 
			var WATT=0;
			var BB = BUFF[i].trim();							//ONE ELEMENT										//POSITION of ( and )
			var CA = BB.indexOf ('(');							//CHECK for LOAD VALUE out of ()
			var CB = BB.indexOf (')');
			if (CB > CA)
			{									    // found  wattage e.g.(100)
				WATT = parseFloat (BB.substring (CA+1,CB).replace (",","."));
				WATT = (WATT*(TIMING/3600000))/1000;					//REQUEST TIMING --> KW/h within timing
				BB= BB.substring (0,CA);
			}
			var newNAME='';
			var isBOOL = true;									//OUT,IN,BUS is processed bool, DMX with load is floating to state value
			switch (BB[0]){										//Check first character and Port number 
				case 'I':		//INPORT valid from 1 to 16
					var PNR = parseInt(BB.substring(2));   // e.g. "IN10" --> Position 2++ has to contain Portnumber
					if (PNR >0 && PNR <16) {					//VALID INPORT NUMBER 1 to 16 (ports with AD Option)
						newNAME = GetIN(PNR);
					}
					break;
				case 'O':		//OUTPORT valid from 1 to 16
					var PNR = parseInt(BB.substring(3));   // e.g. "OUT10" --> Position 2++ has to contain Portnumber
					if (PNR >0 && PNR <16) {					//VALID INPORT NUMBER 1 to 16 (ports with AD Option)
						newNAME = GetOUT(PNR);
					}
					break;
				case 'B':   //BUS Port valid from 1 to 32
					var PNR = parseInt(BB.substring(3));   // e.g. "BUS24" -> Position 3++ has to contain Portnumber
					if (PNR >0 && PNR <33) {					//VALID INPORT NUMBER 1 to 32
						newNAME= GetBUS(PNR);
					}
					break;
				case 'D':   //DMX valid from 1 to 224
					var PNR = parseInt(BB.substring(3));   // e.g. "DMX221" -> Position 3++ has to contain Portnumber
					if (PNR >0 && PNR <225) {					//VALID DMX NUMBER 1 to 224
						newNAME = GetDMX(PNR);
						isBOOL = false;
					}
					break;
				
				default:
					break;
			}
			
			if (newNAME !='')
			{
				PW_REQUEST_KW.push (WATT);				//WATT will remain 0 if no load is forwarded
				PW_REQUEST_NAMES.push (newNAME);
				PW_REQUEST_OUTPUT.push ('STAT_KWH_'+newNAME);
				PW_REQUEST_RUNTIME.push ('STAT_HRS_'+newNAME);
				PW_REQUEST_BOOL.push (isBOOL);
				if (LOG_ALL) {adapter.log.info ("Power measure:" + 'POWER_'+newNAME+ "  Load:" + WATT + " KW/"+TIMING+"ms");}
			}
		}
	}
	
//Initialize ioBrokers state objects if they dont exist
//DMX CHANNELS contain and send DMX value 0-255 to a DMX channel
	for (i=1;i<=DMX_CHANNELS_USED;i++){
		adapter.setObjectNotExists (GetDMX(i),{
			type:'state',
			common:{name:'DMX channel'+i ,type:'number',role:'value',read:true,write:true},
			native:{}
		});
	}
//OUTPORTS contain and send outport value true or false to a outport
	for (i=1;i<=16;i++){
		adapter.setObjectNotExists (GetOUT(i),{
			type:'state',
			common:{name:'OUTPORT'+i,type:'boolean',role:'value',read:true,write:true},
			native:{}
		});		
	}
//INPORTS contain the bool value of an inport
	for (i=1;i<=16;i++){
		adapter.setObjectNotExists (GetIN(i),{
			type:'state',
			common:{name:'INPORT'+i,type:'boolean',role:'value',read:true,write:false},
			native:{}
		});		
	}
		
//IR REMOTE RECEIVE contains the HEX string of the last received IR CODFE (DMXface format 8 Bytes)
	adapter.setObjectNotExists ('IR_RECEIVE',{
		type:'state',
		common:{name:'IR REMOTE RECEIVE',type:'string',role:'value',read:true,write:false},
		native:{}
	});		
		
//SCENEN calls a scene when scene number is written to the object value 
	adapter.setObjectNotExists ('SCENE_CALL',{
		type:'state',
		common:{name:'SCENE NUMBER CALL',type:'number',role:'value',read:true,write:true},
		native:{}
	});		
		
//PROGRAM calls a program when program number is written to the object value 
	adapter.setObjectNotExists ('PROGRAM_CALL',{
		type:'state',
		common:{name:'PROGRAM NUMBER CALL',type:'number',role:'value',read:true,write:true},
		native:{}
	});		
		
//BUS_INPORTS contain and send bus port value true or false to a bus Port 1-32
	for (i=1;i<=32;i++){
		adapter.setObjectNotExists (GetBUS(i),{
			type:'state',
			common:{name:'BUS IO'+i,type:'boolean',role:'value',read:true,write:true},
			native:{}
		});		
	}
		
//User specific requests of addtional port values, create one object for each value
	for (i=0; i < EX_REQUEST_NAMES.length; i++){
		adapter.setObjectNotExists (EX_REQUEST_NAMES[i],{
			type:'state',
			common:{name: EX_REQUEST_NAMES[i],type:'number',role:'value',read:true,write:false},
			native:{}
		});	
		if (EX_MINMAX_TRACKING) {
			adapter.setObjectNotExists (EX_REQUEST_NAMES[i]+"_min",{
				type:'state',
				common:{name: EX_REQUEST_NAMES[i]+"_min",type:'number',role:'value',read:true,write:true},
				native:{}
			});	
			adapter.setObjectNotExists (EX_REQUEST_NAMES[i]+"_max",{
				type:'state',
				common:{name: EX_REQUEST_NAMES[i]+"_max",type:'number',role:'value',read:true,write:true},
				native:{}
			});	
			adapter.setObjectNotExists (EX_REQUEST_NAMES[i]+"_reset",{
				type:'state',
				common:{name: EX_REQUEST_NAMES[i]+"_reset",type:'boolean',role:'value',read:true,write:true},
				native:{}
			});	
		}
	}
	
//POWER Reading Values 	
for (i=0; i < PW_REQUEST_OUTPUT.length; i++){
		//RUNTIME OBJECT hours
		adapter.setObjectNotExists (PW_REQUEST_RUNTIME[i],{
			type:'state',
			common:{name: PW_REQUEST_RUNTIME[i],type:'number',role:'value',read:true,write:true},
			native:{}
		});
		//Consumtion value only if load is forwarded
		if (PW_REQUEST_KW[i] >0)
		{
			adapter.setObjectNotExists (PW_REQUEST_OUTPUT[i],{
				type:'state',
				common:{name: PW_REQUEST_OUTPUT[i],type:'number',role:'value',read:true,write:true},
				native:{}
			});
		}
	}

//Enable receiving of change events for all objects
	adapter.subscribeStates('*');

// Connect the DMXface server (function below)
	CONNECT_CLIENT();

//INITIATE timed request for additional requests if list contains valid ports
	if ((EX_REQUEST_NAMES.length + PW_REQUEST_NAMES.length) > 0) {
		OBJID_REQUEST = setInterval (CLIENT_REQUEST,TIMING);
		if (EX_REQUEST_NAMES.length>0) {adapter.log.info ("Starting " + EX_REQUEST_NAMES.length +" addtional port requests, period: " + TIMING + "ms");}
		if (PW_REQUEST_NAMES.length>0) {adapter.log.info ("Starting " + PW_REQUEST_NAMES.length +" runtime / load states: " + TIMING + "ms");}
	}
});

//************************************* ADAPTER CLOSED BY ioBroker *****************************************
adapter.on ('unload',function (callback){
	APPLICATIONstopp = true
	IS_ONLINE = false;
	clearInterval (OBJID_REQUEST);
	adapter.log.info ('DMXface: Close connection, cancel service');
	client.close;
	callback;
	});


//************************************* Adapter STATE has CHANGED ******************************************	
adapter.on ('stateChange',function (id,obj){
	//adapter.log.info (id + "  /  "+obj);
	if (!IS_ONLINE){return;}							//DMXface Offline	
	if (obj==null) {
		adapter.log.info ('Object: '+ id + ' terminated by user');
		return;
	}
		
	if (obj.from.search (adaptername) != -1) {return;}    // do not process self generated state changes (by dmxface instance) 
														  //exit if sender = dmxface
	var PORTSTRING = id.substring(adaptername.length+3);  				//remove Instance name
	// if (PORTSTRING[0] ='.'){PORTSTRING = id.substring(adaptername.length+4)};  optional removal if more than 10 Instances are used 
	//Statistic value´s are not processed
	if (PORTSTRING.search ('STAT_') > -1) {return;}
	//Reset of min max 
	if (PORTSTRING.search ('_reset') >-1)
	{
		var STATEname = PORTSTRING.replace ("_reset","");
		adapter.getState(STATEname , function (err, state) {	//get current value
			var newVAL =0;
			if (state !=null) {							//EXIT if state is not initialized yet
				if (state.val !=null) {					//Exit if value not initialized
					newVAL= state.val;
				}
			}
			adapter.setState(STATEname+'_min',newVAL,true);
			adapter.setState(STATEname+'_max',newVAL,true);
			adapter.setState(STATEname+'_reset',false,true);
			adapter.log.info ('Reset MIN / MAX of: ' + STATEname);
		});
		return;	
	}

	//Select the object type by the first character of the object name
	//'O' OUTPORT , 'D' DMX, 'B' BUSINPORT, INPORT and IR_RECEIVE cannot be set 
	var PORTNUMBER =-1
	var WDATA 
	switch (PORTSTRING[0]) {
		case 'O':		//OUTPORT
			var PORTNUMBER = parseInt(PORTSTRING.substring(7));
			WDATA= Buffer.from ([0xF0,0x4F,(PORTNUMBER & 0xFF),0]);  // DMXFACE ACTIVE SEND Command switch Portnumber to OFF
			if (obj.val ==true) {WDATA[3] = 1;}						// IF TRUE then ON 
			client.write (WDATA); 
			break;
//REV 1.1 Upgrade auf 544 channels			
		case 'D':		//DMX CHANNEL
			var PORTNUMBER = parseInt(PORTSTRING.substring(3));
			WDATA= Buffer.from ([0xF0,0x44,((PORTNUMBER >> 8)&0xFF),(PORTNUMBER &0xFF),obj.val]);  // DMXFACE ACTIVE SEND Command SET DMX CHANNEL
			client.write (WDATA); 
			break;
		case 'B':	 	//BUS IO 
			var PORTNUMBER = parseInt(PORTSTRING.substring(3));
			PORTNUMBER+=24;
			WDATA= Buffer.from ([0xF0,0x4F,(PORTNUMBER & 0xFF),0]);  // DMXFACE ACTIVE SEND BUS IO
			if (obj.val ==true) {WDATA[3] = 1;}						// IF TRUE then ON 
			client.write (WDATA); 
			break;
		case 'S':  		//SCENE CALLED by the change of the object value 
			var SCENE_NUMBER = obj.val;
			if (SCENE_NUMBER < 1){return;}
			if (SCENE_NUMBER > 180){return;}
			WDATA= Buffer.from ([0xF0,0x53,SCENE_NUMBER]);  // DMXFACE ACTIVE SEND BUS IO
			client.write (WDATA); 
			break;
		
		case 'P':  		//PROGRAM CALLED by the change of the object value   
			var PG_NUMBER = obj.val;
			if (PG_NUMBER < 1){return;}
			if (PG_NUMBER > 28){return;}
			WDATA= Buffer.from ([0xF0,0x50,PG_NUMBER]);  // DMXFACE ACTIVE SEND BUS IO
			client.write (WDATA); 
			break;
		default:
			return;
			break;
	}
});


//************************************* TCP CONNECT /ERROR / CLOSED ****************************************
function CONNECT_CLIENT () {
	IS_ONLINE = false;
	adapter.log.info("Connecting DMXface controller " + IPADR + " "+ PORT);
	client.connect (PORT,IPADR);
}

//CLIENT SUCCESSFUL CONNECTED (CALLBACK from CONNECT_CLIENT)
function CBclientCONNECT () {
	//adapter.setState ('info.connection',true,true);
	adapter.log.info ('DMXface connection established');
	IS_ONLINE = true;
}

//CLIENT ERROR HANDLER AND CONNECTION RESTART
function CBclientERROR(Error) {
	IS_ONLINE = false;											//Flag Connection not longer online
	adapter.log.error ("Error DMXface connection: " + Error);	
	client.close;												//Close the connection
}
function CBclientCLOSED() {
	adapter.log.warn ("DMXface connection closed");
	if (APPLICATIONstopp ==false) {
		var RCTASK = setTimeout (CONNECT_CLIENT,30000);			//within 30 Sec.
		adapter.log.info ("Trying to reconnect in 30sec.");
	}
		
}


//************************************* TIMDED TASK requests additional ports and implements power measurement ****************
function CLIENT_REQUEST	(){
	if (IS_ONLINE == true) {
		if (EX_PTR >= EX_REQUEST_NAMES.length){EX_PTR =0;}   //RESET the POINTER if > array.length
		if (LOG_ALL) {adapter.log.info ("Request:" +EX_REQUEST_NAMES[EX_PTR])}
		var WDATA; 				//TX Buffer
		switch (EX_REQUEST_PORTS[EX_PTR]) {		//Position contains 'I' / 'B' / 'D' Inport , Bus, DMX
			
			case 'I':		//INPORT 1-24, create Request Command
				WDATA= Buffer.from ([0xF0,0x49,0x00,(EX_REQUEST_NUMBERS[EX_PTR] & 0xFF)]);
				client.write (WDATA); 
				break;
			
			case 'B':		//BUS 1-32
				var PNR = (EX_REQUEST_NUMBERS[EX_PTR] +24)//OFFSET BUS same Command but Numbers 25 to 56
				WDATA= Buffer.from ([0xF0,0x49,0x00,PNR]);
				client.write (WDATA); 
				break;
			
			case 'D':		//DMX 1-544
				var PNR = (EX_REQUEST_NUMBERS[EX_PTR] +256)//OFFSET DMX =256 --> 0x0101 to 0x320 max
				WDATA= Buffer.from ([0xF0,0x49,((PNR >> 8) & 0xFF),(PNR & 0xFF)]);
				client.write (WDATA); 
				break;
			case 'C':		//CHARBUFFER 1-8, create Request Command
				var PNR = (EX_REQUEST_NUMBERS[EX_PTR] +0xE0)//OFFSET CHAR BUFFER same Command PORT REQUEST
				WDATA= Buffer.from ([0xF0,0x49,0x00,PNR]);
				client.write (WDATA); 
				break;
			default:
				return;
				break;
		}
		EX_PTR+=1;    //next pointer 
		
		//Power Calculation  log("Gerät Nr. " + i + ": " + getObject(id).name + ": " + status);
		for (var i=0;i< PW_REQUEST_NAMES.length;i++){
			POWERmeasure(i);
		}
	}
}

//Updates the Power value of an channel by the Index of PW_REQUEST_NAMES
function POWERmeasure (i){
	var IDread = adapter.name + '.' + adapter.instance + "." +PW_REQUEST_NAMES[i];
	var IDout = adapter.name + '.' + adapter.instance + "." +PW_REQUEST_OUTPUT[i];
	var IDruntime = adapter.name + '.' + adapter.instance + "." +PW_REQUEST_RUNTIME[i];
	var POWERtoADD = PW_REQUEST_KW[i];
	var PW_bool = PW_REQUEST_BOOL[i];
	var ADDTIME = parseFloat(TIMING)/(1000*3600);
	//get the current state of the port, if port state not exists --> exit
	adapter.getState(IDread, function (err, state) {
		if (state ==null) {return;}							//EXIT if state is not initialized yet
		if (state.val ==null) {return;}						//Exit if value not initialized
		var CURRENT_VALUE = state.val;
		//if port is true or >0 do the powercalculation and runtime adding
		if (CURRENT_VALUE)
			{
			//Power consumtion processing only if load value exists
			if (POWERtoADD >0)
			{
				adapter.getState(IDout, function (err, state) {
					var POWERvalue = 0;
					if (state != null){if (state.val !=null){POWERvalue =  parseFloat(state.val);}}

					if (PW_bool){
						POWERvalue+=POWERtoADD;
					} else {
						POWERvalue+=POWERtoADD*CURRENT_VALUE/255;
					}
					adapter.setState(IDout,POWERvalue,true);
				});	
			}			
			//Get current runtime value, if not exists, create with 0
			adapter.getState(IDruntime, function (err, state) {
				var newRUNTIME = 0;
				if (state != null){if (state.val !=null){newRUNTIME =  parseFloat(state.val);}}
				newRUNTIME+= ADDTIME;
				adapter.setState(IDruntime,newRUNTIME,true);
			});	

		}
	});
	return;
}




//************************************* PROCESSING ASYNCHRON RECEIVED DATA FROM DMXface ******************************************
function CBclientRECEIVE(RXdata) {
	if (RXdata.length < 3) {return;}			// Minimum Length of response ist start 0xF0, Signature 0xnn and at least one data byte 
	
	if (RXdata[0] != 0xF0) {					// CHECK START BYTE =0xF0
		return;
	}
	var i;
	var x;	
	
	switch (RXdata[1]) {
		case 0x01:			// IR CODE 10 Bytes received, 8 Bytes IR Code
			if (RXdata.length == 10){    
				var BUFF = "";
				var IRCODE = "";
				for (i=2;i<10;i++){
					BUFF = RXdata[i].toString(16).toUpperCase();
					//BUFF = BUFF.toUpperCase;
					if (BUFF.length <2) {IRCODE += '0'+BUFF} else {IRCODE += BUFF}
				}
				adapter.setState('IR_RECEIVE',IRCODE,false);
			}
			
			break;

		case 0x02:   		//RECEIVING INPORT STATE INFO //9 Bytes RX length
			if (RXdata.length == 9){    
				var ONOFF = false;
				x =1;
				for (i=1;i<0x81;i*=2){
					if (i & RXdata[8]){ONOFF = true;} else {ONOFF = false;}
					adapter.setState(GetIN(x),ONOFF);
					if (i & RXdata[7]){ONOFF = true;} else {ONOFF = false;}
					adapter.setState(GetIN(x+8),ONOFF);
					//if (i & RXdata[6]){ONOFF = true;} else {ONOFF = false;}
					//adapter.setState(GetIN(x+16),ONOFF);
					if (i & RXdata[5]){ONOFF = true;} else {ONOFF = false;}
					adapter.setState(GetBUS(x),ONOFF);
					if (i & RXdata[4]){ONOFF = true;} else {ONOFF = false;}
					adapter.setState(GetBUS(x+8),ONOFF);
					if (i & RXdata[3]){ONOFF = true;} else {ONOFF = false;}
					adapter.setState(GetBUS(x+16),ONOFF);
					if (i & RXdata[2]){ONOFF = true;} else {ONOFF = false;}
					adapter.setState(GetBUS(x+24),ONOFF);
					x+=1;
				}
			}
			break;
		
		case 0x04:	//OUTPORT  //5 Bytes RX length
			var ONOFF = false;
			if (RXdata.length == 5){   
				x =1;
				for (i=1;i<0x81;i*=2){
					if (i & RXdata[4]){ONOFF = true;} else {ONOFF = false;}
					adapter.setState(GetOUT(x),ONOFF);
					if (i & RXdata[3]){ONOFF = true;} else {ONOFF = false;}
					adapter.setState(GetOUT(x+8),ONOFF);
					x+=1;
				}
			}
			break;
		
		case 0x49: //AD INPORT REQUEST RETURN  0xF0,0x49,PORTNR_HIGH,PORTNR LOW , bDIGITAL VALUE, bANALOG VALUE, 'TEXT VALUE eg. 34.55 GRAD'
			//EXTRACT PORT and Float value, write it to the coreesponding object if exists
			if (RXdata.length > 8){   
				var exFLOAT = 0;				//Resulting float Value 
				var exNUMBER = (RXdata[2]*256)+ RXdata[3]		//PORT NUMBER  1-24 INPORTS 1-24
																//25-56 BUS 1-32
				var exPORTS = '';							    //0x101-0x320 DMX 1-544
				var exNAME ='';
				if (exNUMBER > 0 && exNUMBER <=24) {				
					exPORTS ='I';							// INPORT
					exNAME = "VALUE_" + GetIN(exNUMBER);	// OBJECT NAME
				}
				if (exNUMBER >=25 && exNUMBER <=56) {				
					exNUMBER-=24;							// REMOVE OFFSET
					exPORTS ='B';							// BUS PORT
					exNAME = "VALUE_" + GetBUS(exNUMBER);	// OBJECT NAME
				}
				//UPGRADE REV 1.1  CHAR BUFFER REQUESTS valid from DMXface Firmware 5.17
				if (exNUMBER >=0xE1 && exNUMBER <=0xE8) {				
					exNUMBER-=0xE0;							// REMOVE OFFSET
					exPORTS ='C';							// BUS PORT
					exNAME = "VALUE_" + GetCHARBUFFER(exNUMBER);	// OBJECT NAME
				}
				
				if (exNUMBER >=257 && exNUMBER <=481) {				
					exNUMBER-=256;							// REMOVE OFFSET
					exPORTS ='D';							// BUS PORT
					exNAME = "VALUE_" + GetDMX(exNUMBER);	// OBJECT NAME
				}
				if (exNAME.length==0){return;}				//EXIT if portnumber not applicable
				// get the value string out of RX from pos 6++	
				var strVALUE='';			
				for (i=6;i< RXdata.length;i++){
					strVALUE+=String.fromCharCode (RXdata[i]);
					}	
				//Replace "," to "." and convert to float
				exFLOAT = parseFloat (strVALUE.replace (",","."));
				//Transfer to OBJECT
				if (LOG_ALL){adapter.log.info ("RX: " + exNAME + " DATA:" + exFLOAT)};
				adapter.setState(exNAME,exFLOAT);
				
				if (EX_MINMAX_TRACKING) {
				
					//SET / READ the min /max value for this object, if null set to initial value
					var MIN_CURRENT;
					adapter.getState(exNAME+"_min", (err, state) => 
						{if (state==null) 
							{adapter.setState(exNAME+"_min",exFLOAT);} 
						else 
							{
								if (exFLOAT < state.val){adapter.setState(exNAME+"_min",exFLOAT);}
							}
						}
						);
					var MAX_CURRENT;
					adapter.getState(exNAME+"_max", (err, state) => 
						{if (state==null) 
							{adapter.setState(exNAME+"_max",exFLOAT);} 
						else 
							{
								if (exFLOAT > state.val){adapter.setState(exNAME+"_max",exFLOAT);}
							}
						}
						);
				}
				
			}
			break;
		
		case 0xFF:	//DMX OUT DATA
			var USED_DXMOUT = (RXdata.length-2);
			if (DMX_CHANNELS_USED < USED_DXMOUT) {
				USED_DXMOUT = DMX_CHANNELS_USED;
				}
			
			for (i=1;i <= USED_DXMOUT;i++){
				adapter.setState(GetDMX(i),RXdata[i+1]);				
				}
			break;
			
			
		default:
			return;
			break;
	}

	
}

//************************************* Other support functions *************************************************
function GetDMX (number){
	if (number <10) {return 'DMX00'+number;}
	if (number <100) {return 'DMX0'+number;}
	return 'DMX'+number;
}
function GetOUT (number){
	if (number <10) {return 'OUTPORT0'+number;}
	return 'OUTPORT'+number;
}
function GetIN (number){
	if (number <10) {return 'INPORT0'+number;}
	return 'INPORT'+number;
}
function GetBUS (number){
	if (number <10) {return 'BUS0'+number;}
	return 'BUS'+number;
}
//Rev 1.1 added for char Buffers
function GetCHARBUFFER (number){
	if (number <10) {return 'CHAR0'+number;}
	return 'CHAR'+number;
}




