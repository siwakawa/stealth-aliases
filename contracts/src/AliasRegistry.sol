// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AliasRegistry
 * @notice Registro de aliases legibles para transacciones privadas sobre Railgun
 * @dev Almacena tanto la metadirección sigilosa (ERC-5564) como la dirección Railgun (0zk...)
 *      Los aliases son inmutables una vez registrados (no se pueden modificar ni eliminar)
 */
contract AliasRegistry {
    /// @notice Datos asociados a un alias
    struct AliasData {
        bytes stealthMetaAddress;   // 66 bytes ERC-5564: spending pubkey (33) + viewing pubkey (33)
        string railgunAddress;       // Dirección Railgun en formato "0zk..."
    }

    /// @notice Mapeo de hash del alias -> datos del alias
    mapping(bytes32 => AliasData) private aliases;

    /// @notice Emitido cuando se registra un nuevo alias
    event AliasRegistered(
        bytes32 indexed aliasHash,
        string alias_,
        bytes stealthMetaAddress,
        string railgunAddress,
        address indexed registrant
    );

    /// @notice Registra un nuevo alias con su metadirección sigilosa y dirección Railgun
    /// @param alias_ El alias deseado (3-32 caracteres, a-z, 0-9, _)
    /// @param stealthMetaAddress Metadirección de 66 bytes (33 spending + 33 viewing), según ERC-5564
    /// @param railgunAddress Dirección Railgun en formato "0zk..."
    function register(
        string calldata alias_,
        bytes calldata stealthMetaAddress,
        string calldata railgunAddress
    ) external {
        // 1. Validar longitud del alias
        uint256 len = bytes(alias_).length;
        require(len >= 3 && len <= 32, "Alias: longitud invalida");

        // 2. Validar caracteres y normalizar
        string memory normalized = _validateAndNormalize(alias_);

        // 3. Validar longitud de metadirección (33 spending + 33 viewing = 66 bytes)
        require(
            stealthMetaAddress.length == 66,
            "Metadireccion: debe ser 66 bytes"
        );

        // 4. Validar dirección Railgun
        bytes memory rkBytes = bytes(railgunAddress);
        require(rkBytes.length >= 4 && rkBytes.length <= 200, "Railgun: longitud invalida");
        require(
            rkBytes[0] == "0" && rkBytes[1] == "z" && rkBytes[2] == "k",
            "Railgun: debe empezar con 0zk"
        );

        // 5. Calcular hash del alias normalizado
        bytes32 aliasHash = keccak256(bytes(normalized));

        // 6. Verificar que no exista
        require(aliases[aliasHash].stealthMetaAddress.length == 0, "Alias: ya registrado");

        // 7. Almacenar datos
        aliases[aliasHash] = AliasData({
            stealthMetaAddress: stealthMetaAddress,
            railgunAddress: railgunAddress
        });

        // 8. Emitir evento
        emit AliasRegistered(
            aliasHash,
            normalized,
            stealthMetaAddress,
            railgunAddress,
            msg.sender
        );
    }

    /// @notice Resuelve un alias a todos sus datos
    /// @param alias_ El alias a resolver
    /// @return stealthMetaAddress La metadirección de 66 bytes
    /// @return railgunAddress La dirección Railgun
    function resolve(
        string calldata alias_
    ) external view returns (bytes memory stealthMetaAddress, string memory railgunAddress) {
        string memory normalized = _toLowerCase(alias_);
        bytes32 aliasHash = keccak256(bytes(normalized));
        AliasData storage data = aliases[aliasHash];
        return (data.stealthMetaAddress, data.railgunAddress);
    }

    /// @notice Resuelve un alias a su dirección Railgun únicamente
    /// @param alias_ El alias a resolver
    /// @return La dirección Railgun en formato "0zk..."
    function resolveRailgun(
        string calldata alias_
    ) external view returns (string memory) {
        string memory normalized = _toLowerCase(alias_);
        bytes32 aliasHash = keccak256(bytes(normalized));
        return aliases[aliasHash].railgunAddress;
    }

    /// @notice Resuelve un alias por su hash directamente
    /// @param aliasHash El hash keccak256 del alias normalizado
    /// @return stealthMetaAddress La metadirección de 66 bytes
    /// @return railgunAddress La dirección Railgun
    function resolveByHash(
        bytes32 aliasHash
    ) external view returns (bytes memory stealthMetaAddress, string memory railgunAddress) {
        AliasData storage data = aliases[aliasHash];
        return (data.stealthMetaAddress, data.railgunAddress);
    }

    /// @notice Verifica si un alias está registrado
    /// @param alias_ El alias a verificar
    /// @return true si el alias existe, false en caso contrario
    function isRegistered(
        string calldata alias_
    ) external view returns (bool) {
        string memory normalized = _toLowerCase(alias_);
        bytes32 aliasHash = keccak256(bytes(normalized));
        return aliases[aliasHash].stealthMetaAddress.length > 0;
    }

    /// @notice Verifica si un alias está registrado por su hash
    /// @param aliasHash El hash keccak256 del alias normalizado
    /// @return true si el alias existe, false en caso contrario
    function isRegisteredByHash(bytes32 aliasHash) external view returns (bool) {
        return aliases[aliasHash].stealthMetaAddress.length > 0;
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
    function _validateAndNormalize(
        string memory alias_
    ) internal pure returns (string memory) {
        bytes memory b = bytes(alias_);
        bytes memory result = new bytes(b.length);

        require(b[0] != 0x5F, "Alias: no puede empezar con _");
        require(b[b.length - 1] != 0x5F, "Alias: no puede terminar con _");

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 char = b[i];

            if (char >= 0x61 && char <= 0x7A) {
                result[i] = char;
                continue;
            }
            if (char >= 0x41 && char <= 0x5A) {
                result[i] = bytes1(uint8(char) + 32);
                continue;
            }
            if (char >= 0x30 && char <= 0x39) {
                result[i] = char;
                continue;
            }
            if (char == 0x5F) {
                result[i] = char;
                continue;
            }

            revert("Alias: caracter no permitido");
        }

        return string(result);
    }

    /// @dev Convierte un string a minúsculas (para resolución)
    function _toLowerCase(
        string memory str
    ) internal pure returns (string memory) {
        bytes memory b = bytes(str);
        bytes memory result = new bytes(b.length);

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 char = b[i];
            if (char >= 0x41 && char <= 0x5A) {
                result[i] = bytes1(uint8(char) + 32);
            } else {
                result[i] = char;
            }
        }

        return string(result);
    }
}
