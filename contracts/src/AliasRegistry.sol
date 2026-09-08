// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AliasRegistry
 * @notice Registro de aliases legibles para direcciones sigilosas compatibles con ERC-5564/6538
 * @dev Los aliases son inmutables una vez registrados (no se pueden modificar ni eliminar)
 */
contract AliasRegistry {
    /// @notice Mapeo de hash del alias -> metadirección sigilosa (66 bytes)
    mapping(bytes32 => bytes) private aliases;

    /// @notice Emitido cuando se registra un nuevo alias
    /// @param aliasHash Hash keccak256 del alias normalizado
    /// @param alias_ El alias en texto plano (normalizado a minúsculas)
    /// @param stealthMetaAddress Metadirección sigilosa de 66 bytes
    /// @param registrant Dirección que registró el alias (puede ser Relay Adapt)
    event AliasRegistered(
        bytes32 indexed aliasHash,
        string alias_,
        bytes stealthMetaAddress,
        address indexed registrant
    );

    /// @notice Registra un nuevo alias con su metadirección sigilosa
    /// @param alias_ El alias deseado (3-32 caracteres, a-z, 0-9, _)
    /// @param stealthMetaAddress Metadirección de 66 bytes (33 viewing + 33 spending)
    function register(
        string calldata alias_,
        bytes calldata stealthMetaAddress
    ) external {
        // 1. Validar longitud del alias
        uint256 len = bytes(alias_).length;
        require(len >= 3 && len <= 32, "Alias: longitud invalida");

        // 2. Validar caracteres y normalizar
        string memory normalized = _validateAndNormalize(alias_);

        // 3. Validar longitud de metadirección (33 + 33 = 66 bytes)
        require(
            stealthMetaAddress.length == 66,
            "Metadireccion: debe ser 66 bytes"
        );

        // 4. Calcular hash del alias normalizado
        bytes32 aliasHash = keccak256(bytes(normalized));

        // 5. Verificar que no exista
        require(aliases[aliasHash].length == 0, "Alias: ya registrado");

        // 6. Almacenar mapeo
        aliases[aliasHash] = stealthMetaAddress;

        // 7. Emitir evento
        emit AliasRegistered(
            aliasHash,
            normalized,
            stealthMetaAddress,
            msg.sender
        );
    }

    /// @notice Resuelve un alias a su metadirección sigilosa
    /// @param alias_ El alias a resolver
    /// @return La metadirección de 66 bytes, o bytes vacíos si no existe
    function resolve(
        string calldata alias_
    ) external view returns (bytes memory) {
        string memory normalized = _toLowerCase(alias_);
        bytes32 aliasHash = keccak256(bytes(normalized));
        return aliases[aliasHash];
    }

    /// @notice Resuelve un alias por su hash directamente
    /// @param aliasHash El hash keccak256 del alias normalizado
    /// @return La metadirección de 66 bytes, o bytes vacíos si no existe
    function resolveByHash(
        bytes32 aliasHash
    ) external view returns (bytes memory) {
        return aliases[aliasHash];
    }

    /// @notice Verifica si un alias está registrado
    /// @param alias_ El alias a verificar
    /// @return true si el alias existe, false en caso contrario
    function isRegistered(
        string calldata alias_
    ) external view returns (bool) {
        string memory normalized = _toLowerCase(alias_);
        bytes32 aliasHash = keccak256(bytes(normalized));
        return aliases[aliasHash].length > 0;
    }

    /// @notice Verifica si un alias está registrado por su hash
    /// @param aliasHash El hash keccak256 del alias normalizado
    /// @return true si el alias existe, false en caso contrario
    function isRegisteredByHash(bytes32 aliasHash) external view returns (bool) {
        return aliases[aliasHash].length > 0;
    }

    /// @notice Calcula el hash de un alias (útil para clientes)
    /// @param alias_ El alias a hashear
    /// @return El hash keccak256 del alias normalizado
    function getAliasHash(
        string calldata alias_
    ) external pure returns (bytes32) {
        string memory normalized = _toLowerCase(alias_);
        return keccak256(bytes(normalized));
    }

    /// @dev Valida caracteres permitidos y normaliza a minúsculas
    /// @param alias_ El alias a validar
    /// @return El alias normalizado en minúsculas
    function _validateAndNormalize(
        string memory alias_
    ) internal pure returns (string memory) {
        bytes memory b = bytes(alias_);
        bytes memory result = new bytes(b.length);

        // No puede empezar ni terminar con _
        require(b[0] != 0x5F, "Alias: no puede empezar con _");
        require(b[b.length - 1] != 0x5F, "Alias: no puede terminar con _");

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 char = b[i];

            // a-z (97-122) - copiar directamente
            if (char >= 0x61 && char <= 0x7A) {
                result[i] = char;
                continue;
            }

            // A-Z (65-90) - convertir a minúscula
            if (char >= 0x41 && char <= 0x5A) {
                result[i] = bytes1(uint8(char) + 32);
                continue;
            }

            // 0-9 (48-57) - copiar directamente
            if (char >= 0x30 && char <= 0x39) {
                result[i] = char;
                continue;
            }

            // _ (95) - copiar directamente
            if (char == 0x5F) {
                result[i] = char;
                continue;
            }

            revert("Alias: caracter no permitido");
        }

        return string(result);
    }

    /// @dev Convierte un string a minúsculas (para resolución)
    /// @param str El string a convertir
    /// @return El string en minúsculas
    function _toLowerCase(
        string memory str
    ) internal pure returns (string memory) {
        bytes memory b = bytes(str);
        bytes memory result = new bytes(b.length);

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 char = b[i];
            // A-Z -> a-z
            if (char >= 0x41 && char <= 0x5A) {
                result[i] = bytes1(uint8(char) + 32);
            } else {
                result[i] = char;
            }
        }

        return string(result);
    }
}
