const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());

// Servir los archivos del Frontend de forma desacoplada desde la carpeta public
app.use(express.static('public'));

// Conexión a la plataforma de datos centralizada externa (Supabase / PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Clave secreta para firmar los tokens de sesión JWT
const JWT_SECRET = "CLAVE_SUPER_SECRETA_DE_SIMULACION_BANCARIA";

// =========================================================================
// 1. ALGORITMO DE GENERACIÓN DE NÚMERO DE CUENTA (Módulo 1)
// =========================================================================
function generarNumeroCuenta(idSecuencial) {
    // Paso 1: Concatenación Base (Prefijo 180 + ID formateado a 6 dígitos)
    const prefijo = "180"; 
    const secuencialStr = String(idSecuencial).padStart(6, '0'); 
    const baseIntermedia = prefijo + secuencialStr; 

    // Paso 2: Suma de Dígitos individuales
    let suma = 0;
    for (let i = 0; i < baseIntermedia.length; i++) {
        suma += parseInt(baseIntermedia[i], 10); 
    }

    // Paso 3: Cálculo Módulo 10 y Regla Especial
    let digitoVerificador = suma % 10; 
    if (digitoVerificador === 0) {
        digitoVerificador = 0; 
    }

    // Paso 4: Consolidación Final (10 dígitos)
    return baseIntermedia + digitoVerificador; 
}

// =========================================================================
// 2. MIDDLEWARE: GUARDIÁN DE SEGURIDAD (Autenticación JWT)
// =========================================================================
function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extrae el token del formato "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ error: "Acceso denegado. No se proporcionó un token de sesión activo." });
    }

    jwt.verify(token, JWT_SECRET, (err, usuario) => {
        if (err) {
            return res.status(403).json({ error: "Token de sesión inválido o expirado." });
        }
        req.user = usuario; // Inyecta los datos del usuario autenticado en la petición
        next();
    });
}

// =========================================================================
// 3. ENDPOINTS DE GESTIÓN DE USUARIOS Y AUTENTICACIÓN (Módulo 1)
// =========================================================================

// Registro de Clientes con asignación inmutable y automatizada de cuenta
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Todos los campos de registro son obligatorios." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Encriptación de contraseña
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const tempPlaceholder = '0000000000';
        const userInsertQuery = `
            INSERT INTO users (name, email, password_hash, account_number, balance) 
            VALUES ($1, $2, $3, $4, 5000.00) RETURNING id;
        `;
        const userResult = await client.query(userInsertQuery, [name, email, passwordHash, tempPlaceholder]);
        const userId = userResult.rows[0].id;

        // Ejecución automática del flujo aritmético
        const numeroCuentaDefinitivo = generarNumeroCuenta(userId);

        // Actualización inmutable del identificador financiero definitivo
        const userUpdateQuery = `UPDATE users SET account_number = $1 WHERE id = $2;`;
        await client.query(userUpdateQuery, [numeroCuentaDefinitivo, userId]);

        // Bitácora de Auditoría: Registro de creación de cuenta exitosa
        const logQuery = `
            INSERT INTO audit_logs (user_id, action, status, details)
            VALUES ($1, 'ACCOUNT_CREATED', 'SUCCESS', $2);
        `;
        await client.query(logQuery, [userId, JSON.stringify({ account_number: numeroCuentaDefinitivo, email })]);

        await client.query('COMMIT');

        return res.status(201).json({
            message: "Usuario registrado con éxito",
            user: { id: userId, name, email, account_number: numeroCuentaDefinitivo, balance: "5000.00" }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en registro:", error);
        if (error.code === '23505') return res.status(400).json({ error: "El correo electrónico ya está registrado." });
        return res.status(500).json({ error: "Error interno del servidor al procesar el registro." });
    } finally {
        client.release();
    }
});

// Inicio de Sesión Seguro basado en Tokens JWT
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Correo y contraseña requeridos." });
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (userResult.rows.length === 0) {
            await pool.query(
                `INSERT INTO audit_logs (action, status, details) VALUES ('LOGIN_FAILED', 'FAILED', $1)`,
                [JSON.stringify({ email, reason: "Usuario no encontrado" })]
            );
            return res.status(401).json({ error: "Credenciales incorrectas." });
        }

        const usuario = userResult.rows[0];
        const contraseñaCorrecta = await bcrypt.compare(password, usuario.password_hash);
        
        if (!contraseñaCorrecta) {
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, status, details) VALUES ($1, 'LOGIN_FAILED', 'FAILED', $2)`,
                [usuario.id, JSON.stringify({ email: usuario.email, reason: "Contraseña incorrecta" })]
            );
            return res.status(401).json({ error: "Credenciales incorrectas." });
        }

        // Token firmado válido
        const token = jwt.sign(
            { id: usuario.id, account_number: usuario.account_number, name: usuario.name },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        // Auditoría interna de inicio de sesión exitoso
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, status, details) VALUES ($1, 'LOGIN_SUCCESS', 'SUCCESS', $2)`,
            [usuario.id, JSON.stringify({ email: usuario.email, account_number: usuario.account_number })]
        );

        return res.json({
            message: "Autenticación exitosa",
            token,
            user: { name: usuario.name, account_number: usuario.account_number, balance: usuario.balance }
        });

    } catch (error) {
        console.error("Error en login:", error);
        return res.status(500).json({ error: "Error interno del servidor al autenticar." });
    }
});

// =========================================================================
// 4. CONSULTAS FINANCIERAS Y POSICIÓN GLOBAL (Módulo 2)
// =========================================================================

// Consulta de Perfil y Saldo Disponible (Tablero Principal)
app.get('/api/user/dashboard', autenticarToken, async (req, res) => {
    try {
        const query = 'SELECT name, email, account_number, balance FROM users WHERE id = $1';
        const result = await pool.query(query, [req.user.id]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado." });

        const usuario = result.rows[0];
        usuario.balance = parseFloat(usuario.balance); 

        return res.json({ user: usuario });
    } catch (error) {
        return res.status(500).json({ error: "Error al sincronizar los datos del tablero principal." });
    }
});

// Historial de Movimientos Cronológico con Filtro Dinámico de Tiempo (24h, Semana, Mes, Año)
app.get('/api/user/movements', autenticarToken, async (req, res) => {
    const account_number = req.user.account_number;
    const { rango } = req.query;

    let timeFilter = "";
    if (rango === "24h") {
        timeFilter = "AND created_at >= NOW() - INTERVAL '1 day'";
    } else if (rango === "semana") {
        timeFilter = "AND created_at >= NOW() - INTERVAL '1 week'";
    } else if (rango === "mes") {
        timeFilter = "AND created_at >= NOW() - INTERVAL '1 month'";
    } else if (rango === "año") {
        timeFilter = "AND created_at >= NOW() - INTERVAL '1 year'";
    }

    try {
        const query = `
            SELECT id, source_account, destination_account, amount, concept, created_at 
            FROM transactions 
            WHERE (source_account = $1 OR destination_account = $1) ${timeFilter}
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query, [account_number]);
        return res.json({ movements: result.rows });
    } catch (error) {
        console.error("Error al obtener movimientos:", error);
        return res.status(500).json({ error: "Error al obtener el historial de movimientos." });
    }
});

// =========================================================================
// 5. MOTOR DE TRANSFERENCIAS BANCARIAS (Módulo 3)
// =========================================================================
app.post('/api/transactions/transfer', autenticarToken, async (req, res) => {
    const { target_account, amount, concept } = req.body;
    const source_account = req.user.account_number; 
    const user_id = req.user.id;

    const regexValidacion = /^\d{10}$/;
    if (!regexValidacion.test(target_account)) {
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, status, details) VALUES ($1, 'TRANSFER_FAILED', 'FAILED', $2)`,
            [user_id, JSON.stringify({ reason: "Expresión regular rechazada (Estructura malformada)", target_account, amount })]
        );
        return res.status(400).json({ error: "La cuenta destino no cumple con el formato requerido de 10 dígitos numéricos." });
    }

    if (source_account === target_account) {
        return res.status(400).json({ error: "Operación inválida. No es posible realizar transferencias hacia tu propia cuenta." });
    }

    if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: "El monto económico especificado debe ser mayor a $0.00 pesos." });
    }

    const client = await pool.connect();

    try {
        // --- INICIO DE LA TRANSACCIÓN ACID EN LA BASE DE DATOS ADMINISTRADA ---
        await client.query('BEGIN');

        // 1. Bloquear fila de Cuenta Origen (FOR UPDATE) para prevenir condiciones de carrera y validar fondos
        const sourceQuery = 'SELECT balance FROM users WHERE account_number = $1 FOR UPDATE';
        const sourceResult = await client.query(sourceQuery, [source_account]);
        const currentBalance = parseFloat(sourceResult.rows[0].balance);

        if (currentBalance < parseFloat(amount)) {
            throw new Error('FONDOS_INSUFICIENTES');
        }

        // 2. Bloquear fila de Cuenta Destino (FOR UPDATE) y validar existencia
        const targetQuery = 'SELECT id, name FROM users WHERE account_number = $1 FOR UPDATE';
        const targetResult = await client.query(targetQuery, [target_account]);

        if (targetResult.rows.length === 0) {
            throw new Error('CUENTA_DESTINO_NO_EXISTE');
        }

        // 3. EJECUCIÓN ATÓMICA: Restar saldo a la cuenta de origen
        const deductQuery = 'UPDATE users SET balance = balance - $1 WHERE account_number = $2';
        await client.query(deductQuery, [amount, source_account]);

        // 4. EJECUCIÓN ATÓMICA: Sumar saldo a la cuenta de destino
        const creditQuery = 'UPDATE users SET balance = balance + $1 WHERE account_number = $2';
        await client.query(creditQuery, [amount, target_account]);

        // 5. Insertar registro cronológico en el historial de transacciones
        const transQuery = `
            INSERT INTO transactions (source_account, destination_account, amount, concept)
            VALUES ($1, $2, $3, $4);
        `;
        await client.query(transQuery, [source_account, target_account, amount, concept || 'Transferencia']);

        // 6. Bitácora de Auditoría: Log de transferencia aprobada con éxito
        const auditQuery = `
            INSERT INTO audit_logs (user_id, action, status, details)
            VALUES ($1, 'TRANSFER_APPROVED', 'SUCCESS', $2);
        `;
        const logDetails = { source_account, destination_account: target_account, amount, concept };
        await client.query(auditQuery, [user_id, JSON.stringify(logDetails)]);

        // --- SI TODAS LAS SENTENCIAS FUERON EXITOSAS, SE CONSOLIDA LA OPERACIÓN FINANCIAL ---
        await client.query('COMMIT');

        return res.json({
            message: "¡Transferencia ejecutada con éxito!",
            transferencia: { desde: source_account, para: target_account, monto: amount, concepto: concept }
        });

    } catch (error) {
        // --- SI ALGO FALLA, SE DESHACEN TODOS LOS CAMBIOS DE FORMA AUTOMÁTICA (ROLLBACK) ---
        await client.query('ROLLBACK');
        console.error("Transacción abortada de forma segura:", error.message);

        let errorMsg = "Error interno del sistema al procesar la transferencia bancaria.";
        let statusCode = 500;

        if (error.message === 'FONDOS_INSUFICIENTES') {
            errorMsg = "Fondos insuficientes en tu cuenta de origen para completar este cargo.";
            statusCode = 400;
        } else if (error.message === 'CUENTA_DESTINO_NO_EXISTE') {
            errorMsg = "La cuenta de destino ingresada no está vinculada a ningún cliente en nuestro sistema.";
            statusCode = 404;
        }

        // Bitácora de Auditoría: Registrar el motivo exacto del rechazo financiero
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, status, details) VALUES ($1, 'TRANSFER_FAILED', 'FAILED', $2)`,
            [user_id, JSON.stringify({ reason: error.message, target_account, amount })]
        );

        return res.status(statusCode).json({ error: errorMsg });
    } finally {
        client.release(); // Libera el cliente de vuelta al pool de conexiones
    }
});

// =========================================================================
// 6. GESTIÓN CRUD DE AGENDA DE CUENTAS DESTINO (Módulo 3 y 4)
// =========================================================================

// Dar de alta cuenta de tercero validando unicidad, regex y existencia real
app.post('/api/user/agenda', autenticarToken, async (req, res) => {
    const { alias, target_account_number } = req.body;
    const user_id = req.user.id;
    const my_account = req.user.account_number;

    const regexValidacion = /^\d{10}$/;
    if (!regexValidacion.test(target_account_number)) {
        return res.status(400).json({ error: "El número de cuenta debe constar exactamente de 10 dígitos numéricos." });
    }

    if (target_account_number === my_account) {
        return res.status(400).json({ error: "Restricción: No puedes agregarte a ti mismo a tu agenda de terceros." });
    }

    try {
        const checkUser = await pool.query('SELECT name FROM users WHERE account_number = $1', [target_account_number]);
        if (checkUser.rows.length === 0) {
            return res.status(404).json({ error: "La cuenta destino ingresada no pertenece a ningún cliente registrado." });
        }

        const checkDuplicate = await pool.query(
            'SELECT id, alias FROM saved_accounts WHERE user_id = $1 AND target_account_number = $2',
            [user_id, target_account_number]
        );

        if (checkDuplicate.rows.length > 0) {
            return res.status(400).json({ 
                error: `Esta cuenta ya está registrada en tu agenda bajo el alias de "${checkDuplicate.rows[0].alias}".` 
            });
        }

        const query = `
            INSERT INTO saved_accounts (user_id, alias, target_account_number)
            VALUES ($1, $2, $3) RETURNING id;
        `;
        await pool.query(query, [user_id, alias, target_account_number]);

        await pool.query(
            `INSERT INTO audit_logs (user_id, action, status, details) VALUES ($1, 'ACCOUNT_SAVED', 'SUCCESS', $2)`,
            [user_id, JSON.stringify({ alias, target_account_number })]
        );

        return res.status(201).json({ message: "Contacto guardado exitosamente en tu agenda bancaria." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Error interno al guardar el contacto." });
    }
});

// Obtener agenda completa ordenada alfabéticamente
app.get('/api/user/agenda', autenticarToken, async (req, res) => {
    try {
        const query = 'SELECT id, alias, target_account_number FROM saved_accounts WHERE user_id = $1 ORDER BY alias ASC';
        const result = await pool.query(query, [req.user.id]);
        return res.json({ agenda: result.rows });
    } catch (error) {
        return res.status(500).json({ error: "Error al obtener la agenda de contactos." });
    }
});

// Modificar el Alias de un contacto existente
app.put('/api/user/agenda/:id', autenticarToken, async (req, res) => {
    const contactoId = req.params.id;
    const { nuevoAlias } = req.body;
    const user_id = req.user.id;

    if (!nuevoAlias || nuevoAlias.trim() === "") {
        return res.status(400).json({ error: "El nuevo nombre/alias no puede ser enviado vacío." });
    }

    try {
        const result = await pool.query(
            'UPDATE saved_accounts SET alias = $1 WHERE id = $2 AND user_id = $3',
            [nuevoAlias, contactoId, user_id]
        );

        if (result.rowCount === 0) return res.status(404).json({ error: "Contacto no localizado." });

        return res.json({ message: "Alias modificado con éxito en la agenda." });
    } catch (error) {
        return res.status(500).json({ error: "Error interno al actualizar el alias." });
    }
});

// Eliminar un contacto de la agenda
app.delete('/api/user/agenda/:id', autenticarToken, async (req, res) => {
    const contactoId = req.params.id;
    const user_id = req.user.id;

    try {
        const result = await pool.query('DELETE FROM saved_accounts WHERE id = $1 AND user_id = $2', [contactoId, user_id]);
        
        if (result.rowCount === 0) return res.status(404).json({ error: "Contacto no localizado o no te pertenece." });

        return res.json({ message: "Contacto removido de tu agenda correctamente." });
    } catch (error) {
        return res.status(500).json({ error: "Error interno al eliminar el contacto." });
    }
});

// Inicialización del Servidor Monolítico Bancario
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de simulación bancaria corriendo en puerto ${PORT}`));