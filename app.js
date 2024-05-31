const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const socketIO = require('socket.io');
const http = require('http');
const cors = require('cors');
const moment = require('moment'); // Import moment
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({origin:true, credentials:true}));
// app.use(cors());


const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    // origin: process.env.FRONTEND_URL,
    origin: true,
    methods: ["GET"] 
  },
});

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err.stack);
        process.exit(1); // Exit the process if there's a connection error
    } else {
        console.log('Connected to the database as id ' + connection.threadId);
    }
});

connection.on('error', (err) => {
    console.error('Database error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.error('Database connection was closed.');
    } else if (err.code === 'ER_CON_COUNT_ERROR') {
        console.error('Database has too many connections.');
    } else if (err.code === 'ECONNREFUSED') {
        console.error('Database connection was refused.');
    }
    process.exit(1); // Exit the process if there's an error
});

function processJson(data) {
    let processedData = {
        "uid": data["results"]["uid"],
        "createTime": moment(data["header"]["createTime"]["value"]).format('YYYY-MM-DD HH:mm:ss'), // Format the timestamp
        "pubTime": moment(data["header"]["pubTime"]["value"]).format('YYYY-MM-DD HH:mm:ss'), // Format the timestamp
        "ip_address": data["header"]["source"]["ip"],
        "host_name": data["header"]["source"]["host"],
        "company_Name": "",
        "freeText_summary": data["results"]["freeTextSummary"],
        "item_price": "",
        "quantity": "",
        "question_answer": []
    };

    let freeTextSummary = processedData.freeText_summary;
    let entitiesStartIndex = freeTextSummary.indexOf("::Entities::");
    let qaStartIndex = freeTextSummary.indexOf("::Question Answering::");

    if (entitiesStartIndex !== -1 && qaStartIndex !== -1) {
        let entitiesText = freeTextSummary.substring(entitiesStartIndex, qaStartIndex).trim();
        let entitiesLines = entitiesText.split("\n");
        entitiesLines.forEach(line => {
            if (line.includes("Company Name:")) {
                processedData["company_Name"] = line.split("Company Name:")[1].trim();
            } else if (line.includes("Stock Price:")) {
                processedData["item_price"] = line.split("Stock Price:")[1].trim();
            } else if (line.includes("Quantity:")) {
                processedData["quantity"] = line.split("Quantity:")[1].trim();
            }
        });

        let qaText = freeTextSummary.substring(qaStartIndex).trim();
        let qaStartIndexJson = qaText.indexOf('{');
        let qaEndIndexJson = qaText.lastIndexOf('}') + 1;
        let qaData = JSON.parse(qaText.substring(qaStartIndexJson, qaEndIndexJson).trim())["QA"];
        processedData["question_answer"] = qaData.map(qa => {
            return {
                "Q": qa["question"],
                "A": qa["answer"]
            };
        });
    }

    return processedData;
}

// POST request to store new conversation data
app.post('/process', (req, res) => {
    let data = req.body;
    if (!data) {
        return res.status(400).json({ error: "Invalid input" });
    }

    let processedData = processJson(data);

    const sql = `INSERT INTO Conversation (uid, createTime, pubTime, ip_address, host_name, company_Name, freeText_summary, item_price, quantity, question_answer)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
        processedData.uid,
        processedData.createTime,
        processedData.pubTime,
        processedData.ip_address,
        processedData.host_name,
        processedData.company_Name,
        processedData.freeText_summary,
        processedData.item_price,
        processedData.quantity,
        JSON.stringify(processedData.question_answer)
    ];

    connection.query(sql, values, (error, results, fields) => {
        if (error) {
            console.error('Error inserting conversation data:', error);
            return res.status(500).json({ error: "Internal server error" });
        } else {
            console.log('Conversation data inserted successfully:', results);
            io.emit('newData', processedData); // Emit event to WebSocket clients
            return res.json(processedData);
        }
    });
});

// GET request to fetch all conversation data
app.get('/conversations', (req, res) => {
    const sql = `SELECT * FROM Conversation`;
    connection.query(sql, (error, results, fields) => {
        if (error) {
            console.error('Error fetching conversation data:', error);
            return res.status(500).json({ error: "Internal server error" });
        } else {
            console.log('Conversation data fetched successfully:', results);
            return res.json(results);
        }
    });
});

io.on('connection', (socket) => {
    console.log('WebSocket client connected');

    socket.on('disconnect', () => {
        console.log('WebSocket client disconnected');
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
















